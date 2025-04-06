"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { createTicket } from "../actions/tickets";
import { Chat } from "./chat";
import { Message, Ticket } from "@/types";
import Head from "next/head";

export default function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTicket, setCurrentTicket] = useState<Ticket>();
  const [isMobile, setIsMobile] = useState(false);
  const [showUnreadBadge, setShowUnreadBadge] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Show unread badge when new messages arrive and chat is closed
  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.sender === "bot") {
        setShowUnreadBadge(true);
      }
    }
  }, [messages, isOpen]);

  const handleMessagesUpdate = (newMessages: Message[]) => {
    setMessages(newMessages);
  };

  const handleChatOpen = async () => {
    console.log("handleChatOpen");
    if (!currentTicket) {
      setIsLoading(true);
      try {
        const ticket = await createTicket({
          sender: "bot",
          text: "👋 Hi! I'm Santi from Shameless Collective. What can I help you with?",
          timestamp: new Date().toISOString(),
        });

        if (ticket.status === 200 && "data" in ticket && ticket.data?.id) {
          setCurrentTicket(ticket.data);
          setMessages([
            {
              sender: "bot",
              text: "👋 Hi! I'm Santi from Shameless Collective. What can I help you with?",
              timestamp: new Date().toISOString(),
            },
          ]);
          setIsOpen(true);
          setShowUnreadBadge(false);
        }
      } catch (error) {
        console.error("Error creating chat:", error);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Just toggle visibility if we already have a ticket
      setIsOpen(!isOpen);
      setShowUnreadBadge(false);
    }
  };

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
      </Head>
      <div
        className={`fixed z-40 ${isMobile ? "inset-0" : "bottom-6 right-6"}`}
      >
        <div
          className={`${isMobile ? "h-full flex flex-col-reverse justify-end" : "flex flex-col-reverse items-end gap-4"}`}
        >
          {isOpen && currentTicket && (
            <div
              className={`bg-white shadow-xl overflow-hidden pointer-events-auto transition-all duration-300 ease-in-out z-[60]
                scale-100 opacity-100
                ${
                  isMobile
                    ? "w-full h-[85vh] rounded-t-2xl fixed bottom-0 left-0 right-0"
                    : "w-[400px] h-[600px] rounded-2xl mb-2"
                }`}
            >
              <div className="w-full h-full flex flex-col">
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-4 flex justify-between items-center relative flex-shrink-0">
                  <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
                  <div className="flex items-center gap-3 relative z-10">
                    <div className="w-10 h-10 relative overflow-hidden rounded-full bg-white p-1 ring-2 ring-white/50 shadow-lg">
                      <Image
                        src="/logo.png"
                        alt="Shameless Collective"
                        fill
                        className="object-contain"
                      />
                    </div>
                    <div>
                      <h2 className="font-semibold text-white text-shadow">
                        Shameless Support
                      </h2>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        <p className="text-sm text-blue-100">Online now</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 relative z-10">
                    {isMobile && (
                      <button
                        onClick={() => setIsOpen(false)}
                        className="p-2 hover:bg-white/20 rounded-full transition-colors backdrop-blur-sm"
                        aria-label="Close chat"
                      >
                        <svg
                          className="w-5 h-5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-hidden bg-gradient-to-b from-gray-50 to-white">
                  <Chat
                    inputmessages={messages}
                    inputcurrentTicket={currentTicket}
                    onMessagesUpdate={handleMessagesUpdate}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="fixed bottom-4 right-4 z-50">
            <button
              onClick={handleChatOpen}
              className={`group bg-gradient-to-r from-blue-500 to-blue-600 shadow-lg hover:shadow-xl transition-all duration-300 
                hover:scale-105 rounded-full p-3 relative cursor-pointer
                ${isMobile ? "m-4 ml-auto" : ""}`}
              aria-label="Open chat"
            >
              {isLoading ? (
                <div className="w-14 h-14 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                </div>
              ) : (
                <div className="w-14 h-14 relative overflow-hidden rounded-full bg-white/90 transition-transform group-hover:scale-90 shadow-inner">
                  <div className="absolute inset-1">
                    <Image
                      src="/logo.png"
                      alt="Chat with us"
                      fill
                      className="object-contain pointer-events-none"
                    />
                  </div>
                </div>
              )}
            </button>
            {showUnreadBadge && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-white animate-bounce z-20">
                1
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-600/20 blur-xl rounded-full scale-150 animate-pulse pointer-events-none"></div>
          </div>
        </div>
      </div>
    </>
  );
}
