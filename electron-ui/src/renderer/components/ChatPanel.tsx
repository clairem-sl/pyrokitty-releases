import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@mantine/core';
import { ChatMessage, displayName } from '../../shared/types';
import { useUserContextMenu } from '../hooks/useUserContextMenu';
import { shell } from 'electron';

// Parse message text into spans and clickable links.
// Handles SL-style [url label] and bare URLs.
function renderMessageText(text: string): React.ReactNode {
  // Combined pattern: SL links [url label] or bare URLs
  const pattern = /\[(https?:\/\/\S+)\s+([^\]]+)\]|(https?:\/\/[^\s\]]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[1] || match[3];
    const label = match[2] || url;
    parts.push(
      <a
        key={key++}
        className="chat-link"
        href="#"
        title={url}
        onClick={(e) => { e.preventDefault(); shell.openExternal(url); }}
      >{label}</a>
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

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
  const savedChatTypeRef = useRef<'whisper' | 'normal' | 'shout' | null>(null);
  const overrideKeyRef = useRef<string | null>(null);

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

    const text = oocMode ? `(( ${input.trim()} ))` : input.trim();
    onSendMessage(text, showChatTypes ? chatType : undefined);
    setInput('');
  };

  const [oocMode, setOocMode] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
    if (!showChatTypes || overrideKeyRef.current !== null) return;
    if (e.key === 'Shift') {
      savedChatTypeRef.current = chatType;
      overrideKeyRef.current = 'Shift';
      setChatType('whisper');
    } else if (e.key === 'Control') {
      savedChatTypeRef.current = chatType;
      overrideKeyRef.current = 'Control';
      setChatType('shout');
    } else if (e.key === 'Alt') {
      e.preventDefault();
      savedChatTypeRef.current = chatType;
      overrideKeyRef.current = 'Alt';
      setOocMode(true);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === overrideKeyRef.current) {
      setChatType(savedChatTypeRef.current!);
      savedChatTypeRef.current = null;
      overrideKeyRef.current = null;
      setOocMode(false);
    }
  };

  const handleUserContextMenu = useUserContextMenu();

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
          messages.map((msg) => {
            const isEmote = msg.message.startsWith('/me ') || msg.message === '/me';
            const messageText = isEmote ? msg.message.slice(3) : msg.message;
            return (
              <div
                key={msg.id}
                className={`chat-message ${msg.isOutgoing ? 'outgoing' : ''} ${msg.chatType || ''} ${isEmote ? 'emote' : ''}`}
              >
                <span className="chat-time">{formatTime(msg.timestamp)}</span>
                <span
                  className="chat-sender"
                  onContextMenu={(e) => handleUserContextMenu(e, msg.fromId, msg.fromName)}
                >{displayName(msg.fromName)}</span>
                {msg.chatType && msg.chatType !== 'normal' && (
                  <span className={`chat-type-badge ${msg.chatType}`}>
                    {msg.chatType}
                  </span>
                )}
                <span className="chat-text">{renderMessageText(messageText)}</span>
              </div>
            );
          })
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
          onKeyUp={handleKeyUp}
          onBlur={() => {
            if (overrideKeyRef.current !== null) {
              setChatType(savedChatTypeRef.current!);
              savedChatTypeRef.current = null;
              overrideKeyRef.current = null;
              setOocMode(false);
            }
          }}
          placeholder={oocMode ? '(( OOC ))' : placeholder}
        />
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
    </div>
  );
};
