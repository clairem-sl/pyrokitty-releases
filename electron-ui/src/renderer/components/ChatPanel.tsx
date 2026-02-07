import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@mantine/core';
import { ChatMessage, displayName } from '../../shared/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string, type?: 'whisper' | 'normal' | 'shout') => void;
  title?: string;
  placeholder?: string;
  showChatTypes?: boolean;
  onClear?: () => void;
}

const formatTime = (timestamp: number | undefined): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return `${timestamp}`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  title = 'Chat',
  placeholder = 'Type a message...',
  showChatTypes = false,
  onClear,
}) => {
  const [input, setInput] = useState('');
  const [chatType, setChatType] = useState<'whisper' | 'normal' | 'shout'>('normal');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Auto-scroll to bottom — instant for bulk loads, smooth for new messages
  useEffect(() => {
    const delta = messages.length - prevCountRef.current;
    prevCountRef.current = messages.length;
    const behavior = delta > 3 ? 'instant' as const : 'smooth' as const;
    messagesEndRef.current?.scrollIntoView({ behavior });
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
        {onClear && (
          <button className="chat-clear-btn" onClick={onClear} title="Clear chat history">
            Clear
          </button>
        )}
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
              <span className="chat-sender">{displayName(msg.fromName)}</span>
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
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
    </div>
  );
};
