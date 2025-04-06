"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Ticket {
  id: string;
  orderNumber: string | null;
  email: string | null;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  status: string;
  admin: boolean;
}

interface Message {
  id: number;
  sender: string;
  text: string;
  timestamp: string;
  ticketId: string;
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
    </div>
  );
}

export default function DashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketList, setTicketList] = useState<Ticket[]>([]);
  const [messageList, setMessageList] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/admin/login");
    }
  }, [status, router]);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        setLoading(true);
        console.log("Fetching tickets...");
        const response = await fetch(`/api/admin/tickets?page=${page}`);
        if (!response.ok) {
          throw new Error("Failed to fetch tickets");
        }
        const result = await response.json();
        console.log("Tickets fetched:", result);

        if (page === 1) {
          setTicketList(result.tickets);
        } else {
          setTicketList((prev) => [...prev, ...result.tickets]);
        }

        setHasMore(result.hasMore);
      } catch (error) {
        console.error("Error fetching tickets:", error);
        setError("Failed to fetch tickets");
      } finally {
        setLoading(false);
      }
    };

    fetchTickets();
  }, [page]);

  useEffect(() => {
    const fetchMessages = async () => {
      if (!selectedTicket) return;

      try {
        console.log("Fetching messages for ticket:", selectedTicket.id);
        const response = await fetch(
          `/api/admin/messages?ticketId=${selectedTicket.id}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch messages");
        }
        const result = await response.json();
        console.log("Messages fetched:", result);
        setMessageList(result);
      } catch (error) {
        console.error("Error fetching messages:", error);
        setError("Failed to fetch messages");
      }
    };

    fetchMessages();
  }, [selectedTicket]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newMessage.trim()) return;

    try {
      const response = await fetch("/api/admin/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: "admin",
          text: newMessage,
          ticketId: selectedTicket.id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const newMsg = await response.json();
      setMessageList([...messageList, newMsg]);
      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
      setError("Failed to send message");
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  if (status === "loading") {
    return <LoadingSpinner />;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Tickets List */}
      <div className="w-1/3 bg-white border-r">
        <div className="p-4 border-b">
          <h2 className="text-xl font-semibold">Tickets</h2>
        </div>
        {error && <div className="p-4 text-red-500 text-sm">{error}</div>}
        <div className="overflow-y-auto h-[calc(100vh-4rem)]">
          {ticketList.length === 0 ? (
            <div className="p-4 text-gray-500">No tickets found</div>
          ) : (
            <>
              {ticketList.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                    selectedTicket?.id === ticket.id ? "bg-gray-100" : ""
                  }`}
                  onClick={() => setSelectedTicket(ticket)}
                >
                  <div className="font-medium">
                    {ticket.name || "Anonymous"}
                  </div>
                  <div className="text-sm text-gray-500">{ticket.email}</div>
                  <div className="text-xs text-gray-400">
                    {new Date(ticket.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
              {hasMore && (
                <div className="p-4 text-center">
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="text-blue-500 hover:text-blue-600 disabled:opacity-50"
                  >
                    {loading ? "Loading..." : "Load More"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 flex flex-col">
        {selectedTicket ? (
          <>
            <div className="p-4 border-b bg-white">
              <h3 className="font-semibold">
                {selectedTicket.name || "Anonymous"}
              </h3>
              <div className="text-sm text-gray-500">
                {selectedTicket.email}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messageList.length === 0 ? (
                <div className="text-center text-gray-500">No messages yet</div>
              ) : (
                messageList.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.sender === "bot" ? "justify-start" : "justify-end"
                    }`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg p-3 ${
                        message.sender === "bot"
                          ? "bg-gray-200"
                          : "bg-blue-500 text-white"
                      }`}
                    >
                      <div className="text-sm">{message.text}</div>
                      <div className="text-xs mt-1 opacity-70">
                        {new Date(message.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-4 border-t bg-white"
            >
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-lg border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Send
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a ticket to view messages
          </div>
        )}
      </div>
    </div>
  );
}
