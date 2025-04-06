"use client";
import { useState, useEffect, FormEvent, useRef } from "react";
import { Ticket, Message } from "@/types";
import {
  getMessages,
  getTickets,
  addMessageToTicket,
  updateTicketAdmin,
} from "../actions/tickets";

export default function TicketsPage(): JSX.Element {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [inputMessage, setInputMessage] = useState<string>("");
  const [adminMode, setAdminMode] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Fetch tickets on load
  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const tickets = await getTickets();
        setTickets(tickets);
      } catch (error) {
        console.error("Error fetching tickets:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTickets();
  }, []);

  // Fetch messages when a ticket is selected
  useEffect(() => {
    if (selectedTicket) {
      const fetchMessages = async () => {
        try {
          const messages = await getMessages(selectedTicket.id);
          setMessages(messages);
        } catch (error) {
          console.error("Error fetching messages:", error);
        }
      };

      fetchMessages();
    }
  }, [selectedTicket]);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return (
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const getLastMessage = (ticket: Ticket) => {
    // Filter messages for the current ticket and get the last message
    const ticketMessages = messages.filter(
      (message) => message.ticketId === ticket.id
    );

    if (ticketMessages.length > 0) {
      const lastMessage = ticketMessages[ticketMessages.length - 1];
      // Return a preview of the last message (first 30 characters)
      return lastMessage.text.length > 30
        ? `${lastMessage.text.substring(0, 30)}...`
        : lastMessage.text;
    }
    return "View conversation";
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedTicket) return;

    const newMessage = {
      sender: "bot",
      text: inputMessage.trim(),
      timestamp: new Date().toLocaleTimeString(),
    };

    // Add message to database
    await addMessageToTicket(selectedTicket.id, newMessage);

    // Update local state
    const dbMessage = {
      id: Date.now(), // Temporary ID
      sender: "bot",
      text: inputMessage.trim(),
      timestamp: new Date().toISOString(),
      ticketId: selectedTicket.id,
    };

    setMessages((prev) => [...prev, dbMessage]);
    setInputMessage("");
  };

  const toggleAdminMode = async () => {
    if (!selectedTicket) return;
    await updateTicketAdmin(selectedTicket.id, !adminMode);
    setAdminMode(!adminMode);
  };

  const handleTakeOver = async () => {
    if (!selectedTicket) return;

    try {
      // Update ticket status to "admin-handled"
      // TO DO:
      //   await updateTicketStatus(selectedTicket.id, "admin-handled");

      // Update local state
      setTickets(
        tickets.map((ticket) =>
          ticket.id === selectedTicket.id
            ? { ...ticket, status: "admin-handled" }
            : ticket
        )
      );

      setSelectedTicket({ ...selectedTicket, status: "admin-handled" });
    } catch (error) {
      console.error("Error taking over ticket:", error);
    }
  };

  // Filter tickets based on search term
  const filteredTickets = tickets.filter(
    (ticket) =>
      ticket.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600 font-medium">Loading tickets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50">
      {/* Sidebar - Ticket List */}
      <div
        className={`${
          selectedTicket ? "hidden md:block md:w-1/3 lg:w-1/4" : "w-full"
        } bg-white overflow-y-auto border-r border-gray-200 shadow-sm`}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
          <div className="px-4 py-3 flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-800">Support Tickets</h1>
            <button
              onClick={toggleAdminMode}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                adminMode
                  ? "bg-gray-200 text-gray-800 hover:bg-gray-300"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {adminMode ? "Exit Admin Mode" : "Admin Mode"}
            </button>
          </div>

          {/* Search bar */}
          <div className="px-4 py-2 border-b border-gray-200">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search by email or order #"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Ticket stats */}
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <div className="flex justify-between text-sm">
              <div>
                <span className="font-medium text-gray-600">Total:</span>{" "}
                <span className="font-bold text-gray-800">
                  {tickets.length}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">Open:</span>{" "}
                <span className="font-bold text-green-600">
                  {tickets.filter((t) => t.status === "open").length}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">Admin:</span>{" "}
                <span className="font-bold text-purple-600">
                  {tickets.filter((t) => t.status === "admin-handled").length}
                </span>
              </div>
            </div>
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg
              className="h-12 w-12 mx-auto text-gray-400 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 13h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {searchTerm ? (
              <p>No tickets match your search</p>
            ) : (
              <p>No tickets found</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredTickets.map((ticket) => (
              <div
                key={ticket.id}
                className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedTicket?.id === ticket.id
                    ? "bg-blue-50 border-l-4 border-blue-500"
                    : ""
                }`}
                onClick={() => setSelectedTicket(ticket)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 flex items-center">
                      {ticket.name || "Anonymous User"}
                      {ticket.status === "open" && (
                        <span className="ml-2 w-2 h-2 bg-green-500 rounded-full"></span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 truncate mt-1">
                      {getLastMessage(ticket)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(ticket.updatedAt)}
                  </div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <div className="text-xs font-medium text-gray-600">
                    Order:{" "}
                    {ticket.orderNumber ? (
                      <span className="text-blue-600">
                        {ticket.orderNumber}
                      </span>
                    ) : (
                      <span className="text-gray-400">N/A</span>
                    )}
                  </div>
                  <div
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      ticket.status === "open"
                        ? "bg-green-100 text-green-800"
                        : ticket.status === "admin-handled"
                          ? "bg-purple-100 text-purple-800"
                          : ticket.status === "closed"
                            ? "bg-gray-100 text-gray-800"
                            : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {ticket.status === "admin-handled"
                      ? "Admin"
                      : ticket.status.charAt(0).toUpperCase() +
                        ticket.status.slice(1)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Content - Messages */}
      {selectedTicket ? (
        <div className="flex-1 flex flex-col h-full bg-white">
          {/* Chat Header */}
          <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center">
              <button
                className="mr-3 text-gray-500 hover:text-gray-700 md:hidden"
                onClick={() => setSelectedTicket(null)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  {selectedTicket.name || "Anonymous User"}
                  <span
                    className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                      selectedTicket.status === "open"
                        ? "bg-green-100 text-green-800"
                        : selectedTicket.status === "admin-handled"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {selectedTicket.status === "admin-handled"
                      ? "Admin"
                      : selectedTicket.status.charAt(0).toUpperCase() +
                        selectedTicket.status.slice(1)}
                  </span>
                </h2>
                <div className="text-sm text-gray-600 mt-1">
                  {selectedTicket.orderNumber ? (
                    <span>
                      Order:{" "}
                      <span className="font-medium">
                        {selectedTicket.orderNumber}
                      </span>{" "}
                      | Created: {formatDate(selectedTicket.createdAt)}
                    </span>
                  ) : (
                    <span>Created: {formatDate(selectedTicket.createdAt)}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center">
              {adminMode && selectedTicket.status !== "admin-handled" && (
                <button
                  onClick={handleTakeOver}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors"
                >
                  Take Over
                </button>
              )}
              <button className="ml-2 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <svg
                  className="h-16 w-16 text-gray-300 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                <p className="text-lg font-medium">
                  No messages in this ticket
                </p>
                <p className="text-sm mt-1">
                  Start the conversation by sending a message
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      message.sender === "user"
                        ? "justify-end"
                        : message.sender === "admin"
                          ? "justify-end"
                          : "justify-start"
                    }`}
                  >
                    {message.sender === "bot" && (
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center mr-2 mt-1">
                        <svg
                          className="h-4 w-4 text-blue-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] sm:max-w-[75%] rounded-lg px-4 py-3 shadow-sm ${
                        message.sender === "user"
                          ? "bg-blue-600 text-white"
                          : message.sender === "admin"
                            ? "bg-purple-600 text-white"
                            : "bg-white text-gray-800"
                      }`}
                    >
                      {message.sender === "admin" && (
                        <div className="text-xs font-bold mb-1 text-purple-200 flex items-center">
                          <svg
                            className="h-3 w-3 mr-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          Admin
                        </div>
                      )}
                      <div className="text-sm break-words leading-relaxed">
                        {message.text}
                      </div>
                      <div
                        className={`text-xs mt-1 flex items-center ${
                          message.sender === "user" ||
                          message.sender === "admin"
                            ? "text-blue-100"
                            : "text-gray-500"
                        }`}
                      >
                        {formatDate(message.timestamp)}
                        {(message.sender === "admin" ||
                          message.sender === "bot") && (
                          <svg
                            className="h-3 w-3 ml-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    </div>
                    {message.sender === "user" && (
                      <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center ml-2 mt-1">
                        <svg
                          className="h-4 w-4 text-gray-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Message Input */}
          {adminMode ? (
            <form
              onSubmit={handleSubmit}
              className="p-4 bg-white border-t border-gray-200"
            >
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your response..."
                    className="w-full border border-gray-300 rounded-lg pl-4 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                      />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center"
                >
                  <span>Send</span>
                  <svg
                    className="h-4 w-4 ml-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 flex items-center">
                <span className="mr-4">Quick replies:</span>
                <button className="px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200 mr-2">
                  Thank you
                </button>
                <button className="px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200 mr-2">
                  Order status
                </button>
                <button className="px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">
                  Returns policy
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 bg-white border-t border-gray-200">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-gray-600 mb-2">
                  Admin mode is required to respond
                </p>
                <button
                  onClick={toggleAdminMode}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Enable Admin Mode
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Empty state for desktop when no ticket is selected
        <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50">
          <div className="text-center p-8 max-w-md">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-20 w-20 mx-auto mb-6 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Customer Support Dashboard
            </h2>
            <p className="text-gray-600 mb-6">
              Select a ticket from the list to view the conversation and respond
              to customer inquiries.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <div className="flex items-center justify-center p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="mr-4 bg-green-100 p-3 rounded-full">
                  <svg
                    className="h-6 w-6 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Open Tickets
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {tickets.filter((t) => t.status === "open").length}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-center p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="mr-4 bg-purple-100 p-3 rounded-full">
                  <svg
                    className="h-6 w-6 text-purple-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Admin Handled
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {tickets.filter((t) => t.status === "admin-handled").length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
