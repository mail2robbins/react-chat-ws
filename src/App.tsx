import { useState, useEffect, useRef } from 'react'
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';

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

interface Room {
  id: number;
  name: string;
  created_by: string;
  member_count: number;
}

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';
const WS_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:5001') + '/ws';

// API Endpoints
const API_REGISTER = import.meta.env.VITE_API_REGISTER || '/api/register';
const API_LOGIN = import.meta.env.VITE_API_LOGIN || '/api/login';
const API_ROOMS = import.meta.env.VITE_API_ROOMS || '/api/rooms';
//const API_JOIN_ROOM = import.meta.env.VITE_API_JOIN_ROOM || '/api/rooms/join';
//const API_LEAVE_ROOM = import.meta.env.VITE_API_LEAVE_ROOM || '/api/rooms/leave';
const API_UPLOAD = import.meta.env.VITE_API_UPLOAD || '/api/upload';

// WebSocket Events
//const WS_EVENT_MESSAGE = import.meta.env.VITE_WS_EVENT_MESSAGE || 'message';
//const WS_EVENT_SYSTEM = import.meta.env.VITE_WS_EVENT_SYSTEM || 'system';
//const WS_EVENT_ERROR = import.meta.env.VITE_WS_EVENT_ERROR || 'error';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState<string>(() => localStorage.getItem('username') || '');
  const [error, setError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  //const [showLogin, setShowLogin] = useState(() => !localStorage.getItem('isLoggedIn'));
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const stored = localStorage.getItem('isLoggedIn');
    return stored === 'true';
  });
  
  const [loginForm, setLoginForm] = useState({ 
    username: localStorage.getItem('username') || '', 
    password: '' 
  });
  const [registerForm, setRegisterForm] = useState({ 
    username: '', 
    password: '', 
    email: '',
    confirmPassword: '' 
  });
  const [showRegister, setShowRegister] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isLoggedIn) {
      // Only create a new connection if one doesn't exist or if the current one is closed
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        const connectWebSocket = () => {
          try {
            const ws = new WebSocket(WS_URL);
            console.log('Attempting to connect to WebSocket server:', WS_URL); // Debug log

            ws.onopen = () => {
              console.log('WebSocket connection established'); // Debug log
              setIsConnected(true);
              setError('');
              
              // Send login message to WebSocket server with stored credentials
              ws.send(JSON.stringify({
                type: 'login',
                username: localStorage.getItem('username') || '',
                password: localStorage.getItem('password') || ''
              }));

              // If we're in a room, rejoin it
              if (currentRoom) {
                console.log('Rejoining room after connection:', currentRoom.id); // Debug log
                ws.send(JSON.stringify({
                  type: 'join_room',
                  roomId: currentRoom.id
                }));
              }
            };

            ws.onclose = (event) => {
              console.log('WebSocket connection closed:', event.code, event.reason); // Debug log
              setIsConnected(false);
              wsRef.current = null; // Clear the reference when connection is closed
              
              // Attempt to reconnect after a delay
              setTimeout(() => {
                if (isLoggedIn) {
                  console.log('Attempting to reconnect...'); // Debug log
                  connectWebSocket();
                }
              }, 3000);
            };

            ws.onerror = (error) => {
              console.error('WebSocket error:', error);
              setError('Connection lost. Attempting to reconnect...');
            };

            ws.onmessage = (event) => {
              try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket message:', data); // Debug log
                
                if (data.type === 'error') {
                  setError(data.content);
                  if (data.content.includes('Invalid username or password')) {
                    setIsLoggedIn(false);
                    localStorage.removeItem('isLoggedIn');
                    localStorage.removeItem('username');
                    localStorage.removeItem('password');
                  }
                  return;
                }

                // Handle system messages regardless of room
                if (data.type === 'system') {
                  const newMessage: Message = {
                    id: Date.now(),
                    content: data.content,
                    username: data.username || 'System',
                    type: 'system',
                    timestamp: new Date(data.timestamp || Date.now())
                  };
                  setMessages(prev => [...prev, newMessage]);
                  return;
                }

                // Handle room join confirmation
                if (data.type === 'join_room') {
                  console.log('Room joined successfully:', data);
                  // Update current room if needed
                  if (data.roomId && (!currentRoom || currentRoom.id !== data.roomId)) {
                    const room = rooms.find(r => r.id === data.roomId);
                    if (room) {
                      setCurrentRoom(room);
                    }
                  }
                  return;
                }

                // Process all message types for the current room
                if (data.roomId) {
                  console.log('Processing message:', { messageRoomId: data.roomId, currentRoomId: currentRoom?.id }); // Debug log
                  
                  // Update current room if needed
                  if (!currentRoom || currentRoom.id !== data.roomId) {
                    const room = rooms.find(r => r.id === data.roomId);
                    if (room) {
                      setCurrentRoom(room);
                    }
                  }

                  const newMessage: Message = {
                    id: Date.now(),
                    content: data.content,
                    username: data.username,
                    type: data.type,
                    timestamp: new Date(data.timestamp || Date.now()),
                    imageUrl: data.imageUrl,
                    pdfUrl: data.pdfUrl,
                    pdfName: data.pdfName,
                    emoji: data.emoji
                  };
                  setMessages(prev => [...prev, newMessage]);
                } else {
                  console.log('Message missing room ID:', data); // Debug log
                }
              } catch (error) {
                console.error('Error processing WebSocket message:', error);
                setError('Error processing message');
              }
            };

            wsRef.current = ws;
          } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            setError('Failed to connect to chat server');
          }
        };

        connectWebSocket();
      }

      return () => {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchRooms();
    }
  }, [isLoggedIn]);

  const fetchRooms = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ROOMS}`);
      if (!response.ok) {
        throw new Error('Failed to fetch rooms');
      }
      const data = await response.json();
      setRooms(data);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      setError('Failed to fetch chat rooms');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}${API_LOGIN}`, {
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
      const response = await fetch(`${API_BASE_URL}${API_REGISTER}`, {
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
    if (!currentRoom) {
      setError('Please join a room first');
      return;
    }

    console.log('Sending message:', { room: currentRoom.id, content: inputMessage }); // Debug log

    // Send message to server first
    wsRef.current.send(JSON.stringify({ 
      type: 'message',
      content: inputMessage,
      username: username,
      roomId: currentRoom.id
    }));

    // Only add message to local state after successful send
    const newMessage: Message = {
      id: Date.now(),
      content: inputMessage,
      username: username,
      type: 'message',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newMessage]);
    setInputMessage('');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch(`${API_BASE_URL}${API_UPLOAD}/image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const data = await response.json();
      
      // Send image message through WebSocket first
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && currentRoom) {
        console.log('Sending image message:', { roomId: currentRoom.id, imageUrl: data.path }); // Debug log
        wsRef.current.send(JSON.stringify({
          type: 'image',
          content: 'Sent an image',
          imageUrl: data.path,
          username: username,
          roomId: currentRoom.id
        }));
      }

      // Add message to local state after successful send
      const newMessage: Message = {
        id: Date.now(),
        content: 'Sent an image',
        username: username,
        type: 'image',
        timestamp: new Date(),
        imageUrl: data.path
      };

      setMessages(prev => [...prev, newMessage]);
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
      const response = await fetch(`${API_BASE_URL}${API_UPLOAD}/pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload PDF');
      }

      const data = await response.json();
      
      // Send PDF message through WebSocket first
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && currentRoom) {
        console.log('Sending PDF message:', { roomId: currentRoom.id, pdfUrl: data.path }); // Debug log
        wsRef.current.send(JSON.stringify({
          type: 'pdf',
          content: 'Sent a PDF file',
          pdfUrl: data.path,
          pdfName: file.name,
          username: username,
          roomId: currentRoom.id
        }));
      }

      // Add message to local state after successful send
      const newMessage: Message = {
        id: Date.now(),
        content: 'Sent a PDF file',
        username: username,
        type: 'pdf',
        timestamp: new Date(),
        pdfUrl: data.path,
        pdfName: file.name
      };

      setMessages(prev => [...prev, newMessage]);
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
      const response = await fetch(`${API_BASE_URL}${url}`);
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

  const handleEmojiClick = (emojiObject: EmojiClickData) => {
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

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    try {
      const response = await fetch(`${API_BASE_URL}${API_ROOMS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newRoomName,
          username: username
        }),
      });

      if (!response.ok) {
        throw new Error('Room name already exists. Failed to create room.');
      }

      const data = await response.json();
      setRooms(prev => [...prev, data.room]);
      setShowCreateRoom(false);
      setNewRoomName('');
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Room name already exists. Failed to create room.');
    }
  };

  const handleJoinRoom = async (room: Room) => {
    try {
      // If already in this room, just update the current room
      if (currentRoom?.id === room.id) {
        return;
      }

      // First, join the room via HTTP
      const response = await fetch(`${API_BASE_URL}/api/rooms/${room.id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (!response.ok) {
        // If the error is "Already a member", treat it as a success
        if (data.error === 'Already a member of this room') {
          // Update current room first
          setCurrentRoom(room);
          
          // Send join room message through WebSocket
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            console.log('Sending join room message:', room.id); // Debug log
            wsRef.current.send(JSON.stringify({
              type: 'join_room',
              roomId: room.id
            }));
          }

          // Clear messages after successful join
          setMessages([]);
          return;
        }
        throw new Error(data.error || 'Failed to join room');
      }

      // Update current room with the response data
      setCurrentRoom(data.room);

      // Ensure WebSocket is connected before sending join message
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket connection not available');
      }

      // Send join room message through WebSocket
      console.log('Sending join room message:', room.id); // Debug log
      wsRef.current.send(JSON.stringify({
        type: 'join_room',
        roomId: room.id
      }));

      // Clear messages after successful join
      setMessages([]);

      // Update rooms list with new member count
      setRooms(prevRooms => 
        prevRooms.map(r => 
          r.id === room.id ? { ...r, member_count: data.room.member_count } : r
        )
      );
    } catch (error) {
      console.error('Error joining room:', error);
      setError(error instanceof Error ? error.message : 'Failed to join room. Please try again.');
    }
  };

  const handleLeaveRoom = async () => {
    if (!currentRoom) return;

    try {
      // First, leave the room via HTTP
      const response = await fetch(`${API_BASE_URL}/api/rooms/${currentRoom.id}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to leave room');
      }

      // Send leave room message through WebSocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'leave_room'
        }));
      }

      // Clear current room and messages
      setCurrentRoom(null);
      setMessages([]);

      // Update rooms list with new member count
      setRooms(prevRooms => 
        prevRooms.map(r => 
          r.id === currentRoom.id ? { ...r, member_count: data.room.member_count } : r
        )
      );
    } catch (error) {
      console.error('Error leaving room:', error);
      setError(error instanceof Error ? error.message : 'Failed to leave room');
    }
  };

  if (!isLoggedIn) {
  return (
      <div className="min-h-screen bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-500 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl p-8 w-full max-w-md border border-white/20">
          <h1 className="text-4xl font-bold text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-white to-purple-100">
            Squadline Chat
          </h1>
          
          {error && (
            <div className="mb-4 p-4 rounded-xl bg-red-400/30 text-red-50 text-sm border border-red-400/40">
              {error}
            </div>
          )}

          {showRegister ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Username</label>
                <input
                  type="text"
                  value={registerForm.username}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Email</label>
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Password</label>
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={registerForm.confirmPassword}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                  required
                  minLength={6}
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-white/30 to-white/20 text-white rounded-xl hover:from-white/40 hover:to-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 transition-all duration-200 border border-white/30"
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="w-full py-3 text-white/90 hover:text-white focus:outline-none transition-colors"
              >
                Already have an account? Login
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Username</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                  required
                />
              </div>
      <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-white/30 to-white/20 text-white rounded-xl hover:from-white/40 hover:to-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 transition-all duration-200 border border-white/30"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                className="w-full py-3 text-white/90 hover:text-white focus:outline-none transition-colors"
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
    <div className="min-h-screen bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-500 p-2 sm:p-4">
      {isLoggedIn && (
        <div className="flex flex-col sm:flex-row h-[calc(100vh-1rem)] sm:h-[calc(100vh-2rem)] bg-white/20 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/30">
          {/* Chat Rooms Screen */}
          {!currentRoom && (
            <div className="w-full h-full bg-white/10 p-4 sm:p-6 flex flex-col">
              <div className="flex justify-between items-center mb-6 flex-shrink-0">
                <h2 className="text-white text-xl font-semibold">Chat Rooms</h2>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setShowCreateRoom(true)}
                    className="bg-white/20 hover:bg-white/30 text-white px-3 sm:px-4 py-2 rounded-xl text-sm transition-all duration-200 border border-white/30"
                  >
                    Create Room
                  </button>
                  <button
                    onClick={handleLogout}
                    className="bg-red-400/30 hover:bg-red-400/40 text-red-50 px-3 sm:px-4 py-2 rounded-xl text-sm transition-all duration-200 border border-red-400/40"
                  >
                    Logout
                  </button>
                </div>
              </div>

              {showCreateRoom && (
                <form onSubmit={handleCreateRoom} className="mb-6 space-y-3 flex-shrink-0">
                  {error && (
                    <div className="p-3 bg-red-400/30 text-red-50 rounded-xl text-sm border border-red-400/40">
                      {error}
                    </div>
                  )}
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => {
                      setNewRoomName(e.target.value);
                      setError(''); // Clear error when user starts typing
                    }}
                    placeholder="Room name"
                    className="w-full p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
                    required
                  />
                  <div className="flex space-x-2">
                    <button
                      type="submit"
                      className="flex-1 py-2 bg-gradient-to-r from-white/30 to-white/20 text-white rounded-xl hover:from-white/40 hover:to-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 transition-all duration-200 border border-white/30"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateRoom(false);
                        setNewRoomName('');
                        setError('');
                      }}
                      className="flex-1 py-2 bg-white/10 text-white/90 rounded-xl hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 transition-all duration-200 border border-white/30"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2 overflow-y-auto flex-1 pr-2 -mr-2">
                {rooms.map(room => (
                  <button
                    key={room.id}
                    onClick={() => handleJoinRoom(room)}
                    className={`w-full text-left p-3 rounded-xl transition-all duration-200 border ${
                      currentRoom?.id === room.id
                        ? 'bg-white/30 text-white border-white/40'
                        : 'text-white/90 hover:bg-white/20 border-white/20 hover:border-white/30'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium truncate mr-2">{room.name}</span>
                      <span className="text-xs bg-white/20 px-2 py-1 rounded-full flex-shrink-0">
                        {room.member_count}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat Screen */}
          {currentRoom && (
            <div className="w-full h-full flex flex-col">
              <div className="p-4 sm:p-6 border-b border-white/20 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center justify-between w-full sm:w-auto">
                  <h2 className="text-white text-xl font-semibold truncate max-w-[200px] sm:max-w-none">{currentRoom.name}</h2>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => setCurrentRoom(null)}
                    className="bg-white/20 hover:bg-white/30 text-white px-3 sm:px-4 py-2 rounded-xl text-sm transition-all duration-200 border border-white/30"
                  >
                    Back to Rooms
                  </button>
                  <button
                    onClick={handleLeaveRoom}
                    className="bg-red-400/30 hover:bg-red-400/40 text-red-50 px-3 sm:px-4 py-2 rounded-xl text-sm transition-all duration-200 border border-red-400/40"
                  >
                    Leave Room
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {messages.map((message) => (
                  <div key={message.id}>
                    <div
                      className={`flex ${
                        message.type === 'system' ? 'justify-center' : 
                        message.username === username ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl p-3 sm:p-4 shadow-lg backdrop-blur-sm border ${
                          message.type === 'system'
                            ? 'bg-white/30 text-white text-sm border-white/30'
                            : message.username === username
                            ? 'bg-gradient-to-r from-indigo-400 to-purple-400 text-white border-transparent'
                            : 'bg-white/20 text-white border-white/30'
                        }`}
                      >
                        <div className="text-xs font-medium opacity-90 mb-1">
                          {message.username}
                        </div>
                        {message.type === 'message' && (
                          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                        )}
                        {message.type === 'system' && (
                          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                        )}
                        {message.type === 'image' && message.imageUrl && (
                          <div className="mb-2 relative group">
                            <img 
                              src={`${API_BASE_URL}${message.imageUrl}`}
                              alt="Shared image"
                              className="max-w-full rounded-xl shadow-md"
                            />
                            <button
                              onClick={() => message.imageUrl && handleFileDownload(message.imageUrl, message.imageUrl.split('/').pop() || 'image')}
                              className="absolute bottom-3 right-3 bg-black/40 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-black/60 hover:scale-110"
                              title="Download image"
                            >
                              ⬇️
                            </button>
                          </div>
                        )}
                        {message.type === 'pdf' && message.pdfUrl && (
                          <div className="mb-2 relative group">
                            <div className="flex items-center space-x-3 p-3 bg-white/20 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200 border border-white/30">
                              <span className="text-3xl">📄</span>
                              <span className="text-sm font-medium truncate">{message.pdfName}</span>
                              <button
                                onClick={() => message.pdfUrl && handleFileDownload(message.pdfUrl, message.pdfName || 'document.pdf')}
                                className="ml-auto bg-gradient-to-r from-indigo-400 to-purple-400 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
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
                          </div>
                        )}
                        <span className="text-xs opacity-80 mt-1 block">
                          {message.timestamp.toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            hour12: true 
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="p-4 sm:p-6 border-t border-white/20">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1 min-w-[200px] p-3 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent transition-all duration-200"
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
                      className="px-3 sm:px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl transition-all duration-200 border border-white/30"
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
                    className="px-3 sm:px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl transition-all duration-200 border border-white/30"
                    disabled={!isConnected || isUploading}
                    title="Upload image"
                  >
                    {isUploading ? 'Uploading...' : '📷'}
                  </button>
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    className="px-3 sm:px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl transition-all duration-200 border border-white/30"
                    disabled={!isConnected || isUploading}
                    title="Upload PDF"
                  >
                    {isUploading ? 'Uploading...' : '📄'}
                  </button>
                  <button
                    type="submit"
                    className="px-4 sm:px-6 py-2 bg-gradient-to-r from-indigo-400 to-purple-400 text-white rounded-xl hover:from-indigo-500 hover:to-purple-500 focus:outline-none focus:ring-2 focus:ring-white/40 transition-all duration-200"
                    disabled={!isConnected}
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App
