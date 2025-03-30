import { useState, useEffect, useRef, JSX } from 'react'
import EmojiPicker from 'emoji-picker-react';

interface Message {
  id: number;
  content: string;
  username: string;
  type: 'message' | 'system' | 'image' | 'pdf' | 'error' | 'emoji';
  timestamp: Date;
  imageUrl?: string;
  pdfUrl?: string;
  pdfName?: string;
  emoji?: string;
}

interface User {
  username: string;
  id: number;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState<string>(() => localStorage.getItem('username') || '');
  const [error, setError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const stored = localStorage.getItem('isLoggedIn');
    return stored === 'true';
  });
  const [showLogin, setShowLogin] = useState(() => !localStorage.getItem('isLoggedIn'));
  const [loginForm, setLoginForm] = useState({ 
    username: localStorage.getItem('username') || '', 
    password: '' 
  });
  const [registerForm, setRegisterForm] = useState({ username: '', password: '' });
  const [showRegister, setShowRegister] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isLoggedIn) {
      const ws = new WebSocket('ws://localhost:5001');

      ws.onopen = () => {
        setIsConnected(true);
        setError('');
        // Send login message to WebSocket server with stored credentials
        ws.send(JSON.stringify({
          type: 'login',
          username: localStorage.getItem('username') || '',
          password: localStorage.getItem('password') || ''
        }));
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (isLoggedIn) {
            wsRef.current = new WebSocket('ws://localhost:5001');
          }
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Failed to connect to chat server. Make sure the server is running.');
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'error') {
          setError(data.content);
          setIsLoggedIn(false);
          setShowLogin(true);
          // Clear stored credentials on error
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem('username');
          localStorage.removeItem('password');
          return;
        }

        const newMessage: Message = {
          id: Date.now(),
          content: data.content,
          username: data.username,
          type: data.type,
          timestamp: new Date(),
          imageUrl: data.imageUrl,
          pdfUrl: data.pdfUrl,
          pdfName: data.pdfName,
          emoji: data.emoji
        };
        setMessages(prev => [...prev, newMessage]);
      };

      wsRef.current = ws;

      return () => {
        ws.close();
      };
    }
  }, [isLoggedIn]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5001/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginForm),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      setIsLoggedIn(true);
      setShowLogin(false);
      setUsername(data.user.username);
      setError('');
      
      // Store authentication state and credentials in localStorage
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('username', data.user.username);
      localStorage.setItem('password', loginForm.password);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5001/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registerForm),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Registration successful, switch to login form
      setShowRegister(false);
      setLoginForm({ username: registerForm.username, password: '' });
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Registration failed');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setShowLogin(true);
    setUsername('');
    setMessages([]);
    // Clear all stored data on logout
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    localStorage.removeItem('password');
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const newMessage: Message = {
      id: Date.now(),
      content: inputMessage,
      username: username,
      type: 'message',
      timestamp: new Date()
    };

    // Add message to local state immediately
    setMessages(prev => [...prev, newMessage]);

    // Send message to server
    wsRef.current.send(JSON.stringify({ 
      type: 'message',
      content: inputMessage,
      username: username
    }));
    setInputMessage('');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('http://localhost:5001/upload/image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const data = await response.json();
      
      const newMessage: Message = {
        id: Date.now(),
        content: 'Sent an image',
        username: username,
        type: 'image',
        timestamp: new Date(),
        imageUrl: data.path
      };

      // Add message to local state immediately
      setMessages(prev => [...prev, newMessage]);

      // Send image message through WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'image',
          content: 'Sent an image',
          imageUrl: data.path,
          username: username
        }));
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      setError('Failed to upload image');
    } finally {
      setIsUploading(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await fetch('http://localhost:5001/upload/pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload PDF');
      }

      const data = await response.json();
      
      const newMessage: Message = {
        id: Date.now(),
        content: 'Sent a PDF file',
        username: username,
        type: 'pdf',
        timestamp: new Date(),
        pdfUrl: data.path,
        pdfName: file.name
      };

      // Add message to local state immediately
      setMessages(prev => [...prev, newMessage]);

      // Send PDF message through WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'pdf',
          content: 'Sent a PDF file',
          pdfUrl: data.path,
          pdfName: file.name,
          username: username
        }));
      }
    } catch (error) {
      console.error('Error uploading PDF:', error);
      setError('Failed to upload PDF');
    } finally {
      setIsUploading(false);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = '';
      }
    }
  };

  const handleFileDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(`http://localhost:5001${url}`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      setError('Failed to download file');
    }
  };

  const handleEmojiClick = (emojiObject: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const newMessage: Message = {
        id: Date.now(),
        content: 'Sent an emoji',
        username: username,
        type: 'emoji',
        timestamp: new Date(),
        emoji: emojiObject.emoji
      };

      // Add message to local state immediately
      setMessages(prev => [...prev, newMessage]);

      // Send emoji message through WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'emoji',
        content: 'Sent an emoji',
        emoji: emojiObject.emoji,
        username: username
      }));
    }
    setShowEmojiPicker(false);
  };

  // Close emoji picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 w-full max-w-md">
          <h1 className="text-3xl font-bold text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
            Chat App
          </h1>
          
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}

          {showRegister ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={registerForm.username}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                  minLength={6}
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-200"
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="w-full py-3 text-purple-600 hover:text-purple-700 focus:outline-none"
              >
                Already have an account? Login
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-200"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                className="w-full py-3 text-purple-600 hover:text-purple-700 focus:outline-none"
              >
                Don't have an account? Register
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <header className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white p-4 shadow-lg">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-purple-200">Chat App</h1>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all duration-200"
          >
            Logout
          </button>
        </div>
        <div className="text-sm mt-2">
          Status: <span className={`px-2 py-1 rounded-full text-xs font-medium ${
            isConnected 
              ? "bg-green-500/20 text-green-200" 
              : "bg-red-500/20 text-red-200"
          }`}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
          {username && (
            <span className="ml-3 px-2 py-1 rounded-full bg-white/10 text-white/90">
              {username}
            </span>
          )}
        </div>
        {error && (
          <div className="mt-2 px-3 py-1 rounded-lg bg-red-500/20 text-red-200 text-sm">
            {error}
          </div>
        )}
      </header>
      
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.reduce((acc: JSX.Element[], message, index) => {
          const prevMessage = messages[index - 1];
          const showDate = !prevMessage || 
            new Date(message.timestamp).toDateString() !== new Date(prevMessage.timestamp).toDateString();
          const showUsername = !prevMessage || 
            message.username !== prevMessage.username || 
            message.type === 'system';

          const messageElement = (
            <div key={message.id}>
              {showDate && (
                <div className="flex justify-center my-4">
                  <div className="px-3 py-1 bg-white/50 rounded-full text-sm text-gray-600">
                    {new Date(message.timestamp).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                </div>
              )}
              <div
                className={`flex ${
                  message.type === 'system' ? 'justify-center' : 
                  message.username === username ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl p-4 shadow-lg backdrop-blur-sm ${
                    message.type === 'system'
                      ? 'bg-white/50 text-gray-700 text-sm'
                      : message.username === username
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white'
                      : 'bg-white text-gray-800'
                  }`}
                >
                  {showUsername && message.type !== 'system' && (
                    <div className="text-xs font-medium opacity-80 mb-1">
                      {message.username}
                    </div>
                  )}
                  {message.type === 'message' && (
                    <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                  )}
                  {message.type === 'image' && message.imageUrl && (
                    <div className="mb-2 relative group">
                      <img 
                        src={`http://localhost:5001${message.imageUrl}`}
                        alt="Shared image"
                        className="max-w-full rounded-xl shadow-md"
                      />
                      <button
                        onClick={() => message.imageUrl && handleFileDownload(message.imageUrl, message.imageUrl.split('/').pop() || 'image')}
                        className="absolute bottom-3 right-3 bg-black/60 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-black/80 hover:scale-110"
                        title="Download image"
                      >
                        ⬇️
                      </button>
                    </div>
                  )}
                  {message.type === 'pdf' && message.pdfUrl && (
                    <div className="mb-2 relative group">
                      <div className="flex items-center space-x-3 p-3 bg-white/80 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200">
                        <span className="text-3xl">📄</span>
                        <span className="text-sm font-medium">{message.pdfName}</span>
                        <button
                          onClick={() => message.pdfUrl && handleFileDownload(message.pdfUrl, message.pdfName || 'document.pdf')}
                          className="ml-auto bg-gradient-to-r from-indigo-500 to-purple-500 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
                          title="Download PDF"
                        >
                          ⬇️
                        </button>
                      </div>
                    </div>
                  )}
                  {message.type === 'emoji' && message.emoji && (
                    <div className="flex items-center space-x-2">
                      <span className="text-4xl">{message.emoji}</span>
                      {showUsername && (
                        <span className="text-xs opacity-70">{message.username}</span>
                      )}
                    </div>
                  )}
                  <span className="text-xs opacity-70 mt-1 block">
                    {message.timestamp.toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit',
                      hour12: true 
                    })}
                  </span>
                </div>
              </div>
            </div>
          );

          return [...acc, messageElement];
        }, [])}
        <div ref={messagesEndRef} />
      </main>

      <form onSubmit={handleSendMessage} className="p-4 bg-white/80 backdrop-blur-sm border-t border-gray-200 shadow-lg">
        <div className="flex space-x-3">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent shadow-sm"
            disabled={!isConnected}
          />
          <input
            type="file"
            ref={imageInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
            disabled={!isConnected || isUploading}
          />
          <input
            type="file"
            ref={pdfInputRef}
            onChange={handlePdfUpload}
            accept=".pdf"
            className="hidden"
            disabled={!isConnected || isUploading}
          />
          <div className="relative" ref={emojiPickerRef}>
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-xl hover:from-yellow-500 hover:to-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200"
              disabled={!isConnected}
              title="Add emoji"
            >
              😊
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-2 z-50">
                <EmojiPicker onEmojiClick={handleEmojiClick} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:from-green-600 hover:to-emerald-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200"
            disabled={!isConnected || isUploading}
            title="Upload image"
          >
            {isUploading ? 'Uploading...' : '📷'}
          </button>
          <button
            type="button"
            onClick={() => pdfInputRef.current?.click()}
            className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl hover:from-red-600 hover:to-rose-600 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200"
            disabled={!isConnected || isUploading}
            title="Upload PDF"
          >
            {isUploading ? 'Uploading...' : '📄'}
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200"
            disabled={!isConnected}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default App
