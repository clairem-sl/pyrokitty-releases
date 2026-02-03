import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../../shared/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string, type?: 'whisper' | 'normal' | 'shout') => void;
  title?: string;
  placeholder?: string;
  showChatTypes?: boolean;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  title = 'Chat',
  placeholder = 'Type a message...',
  showChatTypes = false,
}) => {
  const [input, setInput] = useState('');
  const [chatType, setChatType] = useState<'whisper' | 'normal' | 'shout'>('normal');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    onSendMessage(input.trim(), showChatTypes ? chatType : undefined);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h4>{title}</h4>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">No messages yet</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-message ${msg.isOutgoing ? 'outgoing' : ''} ${msg.chatType || ''}`}
            >
              <span className="chat-time">{formatTime(msg.timestamp)}</span>
              <span className="chat-sender">{msg.fromName}</span>
              {msg.chatType && msg.chatType !== 'normal' && (
                <span className={`chat-type-badge ${msg.chatType}`}>
                  {msg.chatType}
                </span>
              )}
              <span className="chat-text">{msg.message}</span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        {showChatTypes && (
          <select
            className="chat-type-select"
            value={chatType}
            onChange={(e) => setChatType(e.target.value as 'whisper' | 'normal' | 'shout')}
          >
            <option value="whisper">Whisper</option>
            <option value="normal">Say</option>
            <option value="shout">Shout</option>
          </select>
        )}
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <button type="submit" className="btn btn-primary chat-send-btn">
          Send
        </button>
      </form>
    </div>
  );
};
