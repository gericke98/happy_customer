"use client";
import { toast, Toaster } from "sonner";
import Image from "next/image";
import { Message, Ticket } from "@/types";
import { addMessageToTicket } from "../actions/tickets";
import { FormEvent, useEffect, useRef, useState, useCallback } from "react";

type ChatProps = {
  inputmessages: Message[];
  inputcurrentTicket: Ticket | undefined;
  onMessagesUpdate: (messages: Message[]) => void;
};

export const Chat = ({
  inputmessages,
  inputcurrentTicket,
  onMessagesUpdate,
}: ChatProps) => {
  const [inputMessage, setInputMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>(inputmessages);
  const [currentTicket, setCurrentTicket] = useState<Ticket | undefined>(
    inputcurrentTicket
  );
  const [textareaHeight, setTextareaHeight] = useState("44px");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Scroll handling
  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;

    const { scrollHeight, scrollTop, clientHeight } = chatContainerRef.current;
    const bottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 50;
    setIsAtBottom(bottom);
  }, []);

  // Scroll to bottom when messages change if we were already at bottom
  useEffect(() => {
    if (isAtBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

  // Add scroll listener
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  // Initial setup from props with error boundary
  useEffect(() => {
    try {
      if (JSON.stringify(messages) !== JSON.stringify(inputmessages)) {
        setMessages(inputmessages);
      }
      if (currentTicket?.id !== inputcurrentTicket?.id) {
        setCurrentTicket(inputcurrentTicket);
      }
    } catch (err) {
      console.error("Error updating chat state:", err);
      toast.error(
        "There was an error updating the chat. Please refresh the page.",
        {
          duration: 5000,
          position: "top-center",
        }
      );
    }
  }, [inputmessages, inputcurrentTicket, messages, currentTicket]);

  // Auto-resize textarea with debounce
  const adjustTextareaHeight = useCallback(() => {
    if (!textareaRef.current) return;

    textareaRef.current.style.height = "44px";
    const scrollHeight = textareaRef.current.scrollHeight;
    const newHeight = Math.min(scrollHeight, 120);
    textareaRef.current.style.height = `${newHeight}px`;
    setTextareaHeight(`${newHeight}px`);
  }, []);

  // Optimized bot response handler
  const getBotResponse = useCallback(
    async (userMessage: string) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        console.log("Sending request to API:", {
          message: userMessage,
          context: messages.map((msg) => ({
            role: msg.sender === "user" ? "user" : "assistant",
            content: msg.text,
          })),
          currentTicket,
        });

        const response = await fetch("/api", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: userMessage,
            context: messages.map((msg) => ({
              role: msg.sender === "user" ? "user" : "assistant",
              content: msg.text,
            })),
            currentTicket,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API Response not OK:", {
            status: response.status,
            statusText: response.statusText,
            body: errorText,
          });
          throw new Error(
            `Error ${response.status}: ${response.statusText}\n${errorText}`
          );
        }

        const data = await response.json();
        console.log("API Response:", data);

        if (data.data?.response) {
          const botMessage = {
            sender: "bot",
            text: data.data.response,
            timestamp: new Date().toISOString(),
          };

          if (currentTicket?.id) {
            await addMessageToTicket(currentTicket.id, botMessage);
            // Get the current messages from state to ensure we have the latest
            setMessages((prevMessages) => {
              const updatedMessages = [...prevMessages, botMessage];
              onMessagesUpdate(updatedMessages);
              return updatedMessages;
            });
          }
        } else {
          console.error("No response in data:", data);
          throw new Error("No response received from bot");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          toast.error("Request timed out. Please try again.");
        } else {
          toast.error(
            `Failed to get response: ${err instanceof Error ? err.message : "Unknown error"}`
          );
        }
        console.error("Bot response error:", err);
      }
    },
    [currentTicket, onMessagesUpdate]
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputMessage.trim() || !currentTicket || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);
    setTextareaHeight("44px");

    try {
      const newMessage = {
        sender: "user",
        text: userMessage,
        timestamp: new Date().toISOString(),
      };

      // First add message to database
      if (currentTicket.id) {
        await addMessageToTicket(currentTicket.id, newMessage);
      }

      // Then update UI
      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
      onMessagesUpdate(updatedMessages);

      // Finally get bot response
      await getBotResponse(userMessage);
    } catch (err) {
      toast.error("Failed to send message. Please try again.");
      console.error("Message submission error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Scroll to bottom button
  const ScrollToBottomButton = () =>
    !isAtBottom && (
      <button
        onClick={() =>
          chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }
        className="absolute bottom-20 right-6 p-2 rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-all duration-200 z-20"
        aria-label="Scroll to latest messages"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      </button>
    );

  return (
    <div className="flex flex-col h-full relative">
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-gradient-to-b from-gray-50 to-white scroll-smooth"
      >
        {messages.map((message, index) => (
          <div
            key={`${message.timestamp}-${index}`}
            className={`flex ${
              message.sender === "user" ? "justify-end" : "justify-start"
            } animate-fade-in-up w-full group`}
            role="listitem"
            aria-label={`${message.sender} message`}
          >
            <div
              className={`flex items-end gap-1.5 max-w-[85%] w-fit ${
                message.sender === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {message.sender === "bot" && (
                <div className="w-6 h-6 mb-0.5 rounded-full overflow-hidden flex-shrink-0 bg-white ring-1 ring-blue-500/10 shadow-sm transition-transform group-hover:scale-105">
                  <div className="relative w-full h-full">
                    <Image
                      src="/logo.png"
                      alt="Bot avatar"
                      fill
                      className="object-contain p-0.5"
                      priority={index === messages.length - 1}
                    />
                  </div>
                </div>
              )}
              <div
                className={`rounded-lg px-3 py-1.5 shadow-sm backdrop-blur-sm
                  ${
                    message.sender === "user"
                      ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white ml-8"
                      : "bg-white/90 text-gray-700 border border-gray-100/50 mr-8"
                  }
                  transform transition-all duration-200 hover:shadow-md group-hover:scale-[1.01]`}
              >
                <div className="whitespace-pre-wrap leading-normal text-sm break-words">
                  {message.text}
                </div>
                <time
                  dateTime={message.timestamp}
                  className={`text-[9px] mt-0.5 block opacity-0 transition-opacity group-hover:opacity-100 ${
                    message.sender === "user"
                      ? "text-blue-100"
                      : "text-gray-400"
                  }`}
                >
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div
            className="flex justify-start animate-fade-in-up"
            role="status"
            aria-label="Loading response"
          >
            <div className="flex items-end gap-1.5">
              <div className="w-6 h-6 mb-0.5 rounded-full overflow-hidden flex-shrink-0 bg-white ring-1 ring-blue-500/10 shadow-sm">
                <div className="relative w-full h-full">
                  <Image
                    src="/logo.png"
                    alt="Bot avatar"
                    fill
                    className="object-contain p-0.5"
                    priority
                  />
                </div>
              </div>
              <div className="bg-white/90 rounded-lg px-3 py-2 shadow-sm border border-gray-100/50">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-blue-500/70 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-blue-500/70 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1.5 h-1.5 bg-blue-500/70 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <ScrollToBottomButton />

      <form
        onSubmit={handleSubmit}
        className="border-t p-4 flex gap-2 items-start bg-white shadow-lg relative"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-gray-50/50"></div>
        <div className="relative z-10 flex-1 flex items-center">
          <textarea
            ref={textareaRef}
            value={inputMessage}
            onChange={(e) => {
              setInputMessage(e.target.value);
              adjustTextareaHeight();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const form = e.currentTarget.form;
                if (form && inputMessage.trim() && !isLoading) {
                  form.requestSubmit();
                }
              }
            }}
            style={{ height: textareaHeight }}
            placeholder="Type a message..."
            className="w-full resize-none rounded-xl border border-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] max-h-[120px] text-gray-900 bg-white/80 backdrop-blur-sm transition-all duration-200 text-base"
            rows={1}
            disabled={isLoading}
            aria-label="Message input"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            inputMode="text"
            enterKeyHint="send"
          />
        </div>
        <div className="relative z-10 flex items-center self-end h-[44px]">
          <button
            type="submit"
            disabled={isLoading || !inputMessage.trim()}
            className="p-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 
              disabled:opacity-50 disabled:hover:from-blue-500 disabled:hover:to-blue-600 flex-shrink-0 transition-all duration-200 
              shadow-sm hover:shadow-md hover:scale-105 active:scale-95 h-full"
            aria-label={isLoading ? "Sending message..." : "Send message"}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M5 12h14m-7-7l7 7-7 7" />
            </svg>
          </button>
        </div>
      </form>
      <Toaster />
    </div>
  );
};
