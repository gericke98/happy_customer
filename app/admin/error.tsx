"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin section error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        Something went wrong!
      </h2>
      <p className="text-gray-600 mb-8">
        We apologize for the inconvenience. Please try again.
      </p>
      <button
        onClick={reset}
        className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Try again
      </button>
    </div>
  );
}
