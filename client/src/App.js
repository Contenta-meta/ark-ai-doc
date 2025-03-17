import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

function App() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
      setStatus("Request cancelled");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();
    
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("http://localhost:3001/api/query/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          threadId, // Include threadId if we have one
        }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(5));

            if (data.event === "error") {
              setError(data.error);
              setLoading(false);
              return;
            }

            if (data.threadId && !threadId) {
              setThreadId(data.threadId);
            }

            if (data.status === "started") {
              setStatus("Assistant is thinking...");
            }

            if (data.status === "in_progress") {
              setStatus("Searching documentation...");
            }

            if (data.status === "completed") {
              setMessages(data.messages);
              setStatus("");
              setLoading(false);
              setQuery("");
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError("Request cancelled");
      } else {
        setError("Failed to send message");
      }
      setLoading(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="App">
      <div className="chat-container">
        <div className="messages">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <ReactMarkdown
                children={message.content}
                remarkPlugins={[remarkGfm]}
              />
              {message.citations && message.citations.length > 0 && (
                <div className="citations">
                  <h4>References:</h4>
                  <ul>
                    {message.citations.map((citation, citationIndex) => (
                      <li key={citationIndex} className="citation">
                        <div className="citation-header">
                          <strong>[{citationIndex}]</strong>
                          <code>{citation.filename}</code>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          {status && <div className="status">{status}</div>}
          {error && <div className="error">{error}</div>}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question..."
            disabled={loading}
          />
          <div className="button-group">
            <button type="submit" disabled={loading || !query.trim()}>
              Send
            </button>
            {loading && (
              <button type="button" onClick={handleCancel} className="cancel-button">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
