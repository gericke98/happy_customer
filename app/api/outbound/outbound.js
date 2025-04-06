import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import Twilio from "twilio";

// Load environment variables from .env file
dotenv.config();

// Check for required environment variables
const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;

if (
  !ELEVENLABS_API_KEY ||
  !ELEVENLABS_AGENT_ID ||
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !TWILIO_PHONE_NUMBER
) {
  console.error("Missing required environment variables");
  throw new Error("Missing required environment variables");
}

// Initialize Fastify server
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const PORT = process.env.PORT || 8000;

// Root route for health check
fastify.get("/", async (_, reply) => {
  reply.send({ message: "Server is running" });
});

// Initialize Twilio client
const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Create a map to store active calls and their callbacks
const activeCallsMap = new Map();

// Helper function to get signed URL for authenticated conversations
async function getSignedUrl() {
  try {
    console.log(
      `[ElevenLabs] Requesting signed URL for agent ID: ${ELEVENLABS_AGENT_ID}`
    );
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[ElevenLabs] Failed to get signed URL: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(`Failed to get signed URL: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[ElevenLabs] Successfully obtained signed URL`);
    return data.signed_url;
  } catch (error) {
    console.error("Error getting signed URL:", error);
    throw error;
  }
}

// Route to initiate outbound calls with callback URL
fastify.post("/outbound-call", async (request, reply) => {
  const { number, prompt, first_message, callbackUrl } = request.body;

  if (!number) {
    return reply.code(400).send({ error: "Phone number is required" });
  }

  try {
    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to: number,
      url: `https://${
        request.headers.host
      }/outbound-call-twiml?prompt=${encodeURIComponent(
        prompt
      )}&first_message=${encodeURIComponent(first_message)}`,
    });

    // Store the callback URL if provided
    if (callbackUrl) {
      activeCallsMap.set(call.sid, {
        callbackUrl,
        status: "initiated",
        startTime: new Date(),
      });
    }

    reply.send({
      success: true,
      message: "Call initiated",
      callSid: call.sid,
    });
  } catch (error) {
    console.error("Error initiating outbound call:", error);
    reply.code(500).send({
      success: false,
      error: "Failed to initiate call",
    });
  }
});

// TwiML route for outbound calls
fastify.all("/outbound-call-twiml", async (request, reply) => {
  const prompt = request.query.prompt || "";
  const first_message = request.query.first_message || "";

  // Properly escape XML special characters
  const escapedPrompt = prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const escapedFirstMessage = first_message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${escapedPrompt}" />
            <Parameter name="first_message" value="${escapedFirstMessage}" />
          </Stream>
        </Connect>
      </Response>`;

  console.log("[Twilio] Sending TwiML response:", twimlResponse);
  reply.type("text/xml").send(twimlResponse);
});

// WebSocket route for handling media streams
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get("/outbound-media-stream", { websocket: true }, (ws) => {
    console.info("[Server] Twilio connected to outbound media stream");

    // Variables to track the call
    let streamSid = null;
    let callSid = null;
    let elevenLabsWs = null;
    let customParameters = null; // Add this to store parameters

    // Handle WebSocket errors
    ws.on("error", console.error);

    // Set up ElevenLabs connection
    const setupElevenLabs = async () => {
      try {
        const signedUrl = await getSignedUrl();
        elevenLabsWs = new WebSocket(signedUrl);

        elevenLabsWs.on("open", () => {
          console.log("[ElevenLabs] Connected to Conversational AI");

          // Send initial configuration with prompt and first message
          let initialConfig = {
            type: "conversation_initiation_client_data",
          };
          // Try with just the first_message without prompt override
          initialConfig.dynamic_variables = {
            customer_name: "Silvia",
            tracking_number: "A123456",
            new_address: "Calle Fernández de los Ríos 92, 28015, Madrid",
          };
          // Only include prompt override if we have custom parameters
          if (customParameters?.prompt || customParameters?.first_message) {
            initialConfig.conversation_config_override = {
              agent: {
                first_message: customParameters?.first_message || "Hola!",
                prompt: customParameters?.prompt || "",
              },
            };

            console.log(
              "[ElevenLabs] Sending initial config with first_message only:",
              initialConfig.conversation_config_override.agent.first_message
            );
          } else {
            console.log(
              "[ElevenLabs] Sending basic initialization without overrides"
            );
          }

          // Send the configuration to ElevenLabs
          elevenLabsWs.send(JSON.stringify(initialConfig));
        });

        elevenLabsWs.on("message", (data) => {
          try {
            const message = JSON.parse(data);
            console.log(`[ElevenLabs] Received message type: ${message.type}`);

            switch (message.type) {
              case "conversation_initiation_metadata":
                console.log("[ElevenLabs] Received initiation metadata");
                break;

              case "audio":
                if (streamSid) {
                  if (message.audio?.chunk) {
                    const audioData = {
                      event: "media",
                      streamSid,
                      media: {
                        payload: message.audio.chunk,
                      },
                    };
                    ws.send(JSON.stringify(audioData));
                  } else if (message.audio_event?.audio_base_64) {
                    const audioData = {
                      event: "media",
                      streamSid,
                      media: {
                        payload: message.audio_event.audio_base_64,
                      },
                    };
                    ws.send(JSON.stringify(audioData));
                  }
                } else {
                  console.log(
                    "[ElevenLabs] Received audio but no StreamSid yet"
                  );
                }
                break;

              case "interruption":
                if (streamSid) {
                  ws.send(
                    JSON.stringify({
                      event: "clear",
                      streamSid,
                    })
                  );
                }
                break;

              case "ping":
                if (message.ping_event?.event_id) {
                  elevenLabsWs.send(
                    JSON.stringify({
                      type: "pong",
                      event_id: message.ping_event.event_id,
                    })
                  );
                }
                break;

              case "agent_response":
                console.log(
                  `[Twilio] Agent response: ${message.agent_response_event?.agent_response}`
                );
                break;

              case "user_transcript":
                console.log(
                  `[Twilio] User transcript: ${message.user_transcription_event?.user_transcript}`
                );
                break;

              default:
                console.log(
                  `[ElevenLabs] Unhandled message type: ${message.type}`
                );
            }
          } catch (error) {
            console.error("[ElevenLabs] Error processing message:", error);
          }
        });

        elevenLabsWs.on("error", (error) => {
          console.error("[ElevenLabs] WebSocket error:", error);
        });

        elevenLabsWs.on("close", (code, reason) => {
          console.log(
            `[ElevenLabs] Disconnected with code: ${code}, reason: ${
              reason || "No reason provided"
            }`
          );

          // If disconnected due to prompt override not allowed, try to reconnect without prompt
          if (reason && reason.includes("Prompt override is not allowed")) {
            console.log(
              "[ElevenLabs] Attempting to reconnect without prompt override"
            );

            // Set a flag to indicate we should not use prompt override
            if (customParameters) {
              delete customParameters.prompt;
            }

            // Try to reconnect after a short delay
            setTimeout(() => {
              setupElevenLabs();
            }, 1000);
          }
        });
      } catch (error) {
        console.error("[ElevenLabs] Setup error:", error);
      }
    };

    // Set up ElevenLabs connection
    setupElevenLabs();

    // Handle messages from Twilio
    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.event !== "media") {
          console.log(`[Twilio] Received event: ${msg.event}`);
        }

        switch (msg.event) {
          case "start":
            streamSid = msg.start.streamSid;
            callSid = msg.start.callSid;
            customParameters = msg.start.customParameters;
            console.log(
              `[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`
            );
            console.log("[Twilio] Start parameters:", customParameters);
            break;

          case "media":
            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
              const audioMessage = {
                user_audio_chunk: Buffer.from(
                  msg.media.payload,
                  "base64"
                ).toString("base64"),
              };
              elevenLabsWs.send(JSON.stringify(audioMessage));
            }
            break;

          case "stop":
            console.log(
              `[Twilio] Stream ${streamSid} ended for call ${callSid}`
            );

            // Call has ended, trigger callback if exists
            if (callSid && activeCallsMap.has(callSid)) {
              const callData = activeCallsMap.get(callSid);
              callData.status = "completed";
              callData.endTime = new Date();

              // Trigger the callback
              if (callData.callbackUrl) {
                console.log(`[Twilio] Triggering callback for call ${callSid}`);
                fetch(callData.callbackUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    callSid,
                    status: "completed",
                    duration: (callData.endTime - callData.startTime) / 1000, // in seconds
                    timestamp: new Date().toISOString(),
                  }),
                }).catch((err) => {
                  console.error(
                    `[Twilio] Error triggering callback for call ${callSid}:`,
                    err
                  );
                });
              }

              // Clean up after some time
              setTimeout(() => {
                activeCallsMap.delete(callSid);
              }, 60000); // Remove from map after 1 minute
            }

            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
              elevenLabsWs.close();
            }
            break;

          default:
            console.log(`[Twilio] Unhandled event: ${msg.event}`);
        }
      } catch (error) {
        console.error("[Twilio] Error processing message:", error);
      }
    });

    // Handle WebSocket closure
    ws.on("close", () => {
      console.log("[Twilio] Client disconnected");
      if (elevenLabsWs?.readyState === WebSocket.OPEN) {
        elevenLabsWs.close();
      }
    });
  });
});

// Add a route to check call status (as a backup)
fastify.get("/call-status/:callSid", async (request, reply) => {
  const { callSid } = request.params;

  if (!callSid) {
    return reply.code(400).send({ error: "Call SID is required" });
  }

  console.log(`[Twilio] Checking status for call ${callSid}`);

  // First check our local map
  if (activeCallsMap.has(callSid)) {
    const callData = activeCallsMap.get(callSid);
    console.log(
      `[Twilio] Found call in local map with status: ${callData.status}`
    );
    return reply.send({
      success: true,
      callSid,
      status: callData.status,
      startTime: callData.startTime,
      endTime: callData.endTime,
    });
  }

  // If not in our map, check with Twilio
  try {
    console.log(`[Twilio] Fetching call status from Twilio API for ${callSid}`);
    const call = await twilioClient.calls(callSid).fetch();
    console.log(`[Twilio] API returned status: ${call.status}`);

    reply.send({
      success: true,
      callSid: call.sid,
      status: call.status,
      duration: call.duration,
      direction: call.direction,
      startTime: call.startTime,
      endTime: call.endTime,
    });
  } catch (error) {
    console.error("Error fetching call status:", error);
    reply.code(500).send({
      success: false,
      error: "Failed to fetch call status",
      message: error.message,
    });
  }
});

// Start the Fastify server
fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`[Server] Listening on port ${PORT}`);
});
