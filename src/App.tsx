

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { defaultQuizData } from './data';
import './Game.css';
import { Mic, MicOff, Phone, Share2 } from 'lucide-react';

// --- Types ---
interface Player {
  id: string;
  name: string;
  team: 1 | 2;
}

interface Question {
  text: string;
  options: string[];
  correctAnswer: string;
}

// --- Socket Setup ---
const socket: Socket = io(window.location.origin);

export default function App() {
  // --- State ---
  const [view, setView] = useState<'lobby' | 'countdown' | 'game' | 'win'>('lobby');
  const [roomID, setRoomID] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [myTeam, setMyTeam] = useState<1 | 2 | null>(null);
  const [ropePosition, setRopePosition] = useState(50);
  const [winnerName, setWinnerName] = useState('');
  const [countdown, setCountdown] = useState(3);
  
  // Quiz State
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [isAnswered, setIsAnswered] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  // Voice Chat State
  const [isMuted, setIsMuted] = useState(false);
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);

  // --- Effects ---

  useEffect(() => {
    // Check URL for room ID
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomID(roomParam);
    }

    // Socket Listeners
    socket.on('connect', () => {
        console.log("Connected to server", socket.id);
    });

    socket.on('player_joined', ({ players }: { players: Player[] }) => {
      setPlayers(players);
      const me = players.find(p => p.id === socket.id);
      if (me) setMyTeam(me.team);
    });

    socket.on('joined_success', ({ player }: { player: Player }) => {
        setMyTeam(player.team);
    });

    socket.on('game_started', () => {
      setView('countdown');
      let count = 3;
      setCountdown(3);
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(interval);
          setView('game');
          loadNextQuestion();
        }
      }, 1000);
    });

    socket.on('state_update', ({ ropePosition }) => {
      setRopePosition(ropePosition);
    });

    socket.on('game_over', ({ winnerName }) => {
      setWinnerName(winnerName);
      setView('win');
    });

    socket.on('opponent_left', () => {
      alert('Opponent disconnected!');
      window.location.reload();
    });

    // WebRTC Listeners
    socket.on('offer', async (payload) => {
      if (!peerConnection.current) createPeerConnection(payload.caller);
      try {
        await peerConnection.current?.setRemoteDescription(payload.sdp);
        const answer = await peerConnection.current?.createAnswer();
        await peerConnection.current?.setLocalDescription(answer);
        socket.emit('answer', { target: payload.caller, sdp: answer });
      } catch (e) {
        console.error("Error handling offer", e);
      }
    });

    socket.on('answer', async (payload) => {
      try {
        await peerConnection.current?.setRemoteDescription(payload.sdp);
      } catch (e) {
        console.error("Error handling answer", e);
      }
    });

    socket.on('ice-candidate', async (payload) => {
      try {
        if (payload.candidate) {
            await peerConnection.current?.addIceCandidate(payload.candidate);
        }
      } catch (e) {
        console.error("Error adding ice candidate", e);
      }
    });

    return () => {
      socket.off('player_joined');
      socket.off('game_started');
      socket.off('state_update');
      socket.off('game_over');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
    };
  }, []);

  // --- Logic ---

  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: targetId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current!);
      });
    }

    peerConnection.current = pc;
    return pc;
  };

  const startVoiceChat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true; // Mute local echo
      }
      setIsVoiceConnected(true);

      // Initiate call if we have an opponent
      const opponent = players.find(p => p.id !== socket.id);
      if (opponent) {
        const pc = createPeerConnection(opponent.id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: opponent.id, caller: socket.id, sdp: offer });
      }
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const joinRoom = () => {
    if (!playerName || !roomID) return alert("Please enter name and room ID");
    socket.emit('join_room', { roomId: roomID, name: playerName });
  };

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomID(newRoomId);
    // Don't join yet, let user enter name
  };

  const startGame = () => {
    socket.emit('start_game', { roomId: roomID });
  };

  const copyInvite = () => {
    const url = `${window.location.origin}?room=${roomID}`;
    navigator.clipboard.writeText(url);
    alert("Link copied to clipboard!");
  };

  const loadNextQuestion = () => {
    const randomIndex = Math.floor(Math.random() * defaultQuizData.length);
    const q = defaultQuizData[randomIndex];
    setCurrentQuestion(q);
    
    // Shuffle options
    const opts = [...q.options];
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    setShuffledOptions(opts);
    setIsAnswered(false);
    setSelectedOption(null);
    setIsCorrect(null);
  };

  const handleAnswer = (option: string) => {
    if (isAnswered || !currentQuestion) return;
    setIsAnswered(true);
    setSelectedOption(option);

    const correct = option === currentQuestion.correctAnswer;
    setIsCorrect(correct);

    let delta = 0;
    if (myTeam === 1) {
        delta = correct ? 5 : -5;
    } else {
        delta = correct ? -5 : 5;
    }

    socket.emit('update_score', { roomId: roomID, delta });

    setTimeout(() => {
      loadNextQuestion();
    }, 1000);
  };

  // --- Render ---

  if (view === 'lobby') {
    return (
      <div className="game-container">
        <div className="overlay">
          <div className="setup-box">
            <h2>ناوی گروپەکان بنووسە</h2>
            <p style={{ fontSize: '14px', color: '#666' }}>بۆ دەستپێکردنی کێبڕکێیەکە ناوی خۆت بنووسە</p>
            
            <input 
              type="text" 
              placeholder="ناوی خۆت" 
              value={playerName} 
              onChange={e => setPlayerName(e.target.value)} 
            />
            
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <input 
                type="text" 
                placeholder="Room ID" 
                value={roomID} 
                onChange={e => setRoomID(e.target.value)} 
                style={{ width: '60%' }}
                />
                <button className="btn-start-game" onClick={joinRoom} style={{ marginTop: 0, fontSize: '14px' }}>
                    Join
                </button>
            </div>

            <p>یان</p>
            <button className="btn-copy-link" onClick={createRoom}>
                 Create New Room
            </button>

            {players.length > 0 && (
                <div style={{ marginTop: '20px', textAlign: 'left' }}>
                    <h3>Players:</h3>
                    <ul>
                        {players.map(p => (
                            <li key={p.id} style={{ color: p.team === 1 ? '#1565c0' : '#c62828' }}>
                                {p.name} {p.id === socket.id ? '(You)' : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {players.length === 2 && (
                <button className="btn-start-game" onClick={startGame}>
                    دەستپێکردن
                </button>
            )}
             {players.length > 0 && (
                 <button className="btn-copy-link" onClick={copyInvite} style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', margin: '10px auto'}}>
                    <Share2 size={16}/> Invite Friend
                 </button>
             )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'countdown') {
    return (
      <div className="game-container">
        <div className="overlay">
            <div id="countdown-container">
                <div id="count-num">{countdown}</div>
                <h2>ئامادەبە...</h2>
            </div>
        </div>
      </div>
    );
  }

  if (view === 'win') {
      return (
        <div className="game-container">
            <div className="overlay">
                <div className="win-modal show-modal">
                    <div style={{ fontSize: '60px' }}>🏆</div>
                    <h2 style={{ margin: '10px 0', color: '#d32f2f' }}>{winnerName}</h2>
                    <p>سەرکەوتوو بوو!</p>
                    <button className="btn-restart" onClick={() => window.location.reload()}>دیسان یاری بکە</button>
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="game-container">
      {/* Voice Chat Audio Elements */}
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay />

      <div className="game-wrapper">
        {/* Left Side (Team 2 - Red) */}
        <div className="calc-box" style={{ opacity: myTeam === 2 ? 1 : 0.5, pointerEvents: myTeam === 2 ? 'auto' : 'none' }}>
            <div className={`q-display red-theme ${currentQuestion && /^[A-Za-z0-9]/.test(currentQuestion.text) ? 'ltr-text' : 'rtl-text'}`}>
                {myTeam === 2 ? currentQuestion?.text : "Waiting for opponent..."}
            </div>
            <div className="options-grid">
                {myTeam === 2 && shuffledOptions.map((opt, idx) => {
                    let btnClass = "option-btn";
                    if (isAnswered) {
                        if (opt === currentQuestion?.correctAnswer) btnClass += " correct-anim";
                        else if (opt === selectedOption) btnClass += " wrong-anim";
                    }
                    return (
                        <button 
                            key={idx} 
                            className={btnClass}
                            onClick={() => handleAnswer(opt)}
                            disabled={isAnswered}
                            dir="auto"
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>

        {/* Center Stage */}
        <div className="center-stage">
            <div className="title">
                dr.Hussein.Chemistry 🔄
            </div>
            <div className="divider"></div>
            <div className="tug-container" id="rope-group" style={{ left: `${ropePosition}%` }}>
                {/* Placeholder SVG for Tug of War */}
                <svg viewBox="0 0 600 100" className="tug-image">
                    <line x1="0" y1="50" x2="600" y2="50" stroke="#8d6e63" strokeWidth="10" />
                    {/* Left Team */}
                    <circle cx="50" cy="50" r="30" fill="#c62828" />
                    <text x="50" y="55" textAnchor="middle" fill="white" fontSize="12">Red</text>
                    {/* Right Team */}
                    <circle cx="550" cy="50" r="30" fill="#1565c0" />
                    <text x="550" y="55" textAnchor="middle" fill="white" fontSize="12">Blue</text>
                </svg>
                <div className="center-marker"></div>
            </div>

            {/* Voice Controls */}
            <div className="voice-controls">
                {!isVoiceConnected ? (
                    <button className="voice-btn" onClick={startVoiceChat} title="Join Voice Chat">
                        <Phone />
                    </button>
                ) : (
                    <>
                        <button className={`voice-btn ${isMuted ? 'muted' : 'active'}`} onClick={toggleMute}>
                            {isMuted ? <MicOff /> : <Mic />}
                        </button>
                    </>
                )}
            </div>
        </div>

        {/* Right Side (Team 1 - Blue) */}
        <div className="calc-box" style={{ opacity: myTeam === 1 ? 1 : 0.5, pointerEvents: myTeam === 1 ? 'auto' : 'none' }}>
            <div className={`q-display blue-theme ${currentQuestion && /^[A-Za-z0-9]/.test(currentQuestion.text) ? 'ltr-text' : 'rtl-text'}`}>
                {myTeam === 1 ? currentQuestion?.text : "Waiting for opponent..."}
            </div>
            <div className="options-grid">
                {myTeam === 1 && shuffledOptions.map((opt, idx) => {
                    let btnClass = "option-btn";
                    if (isAnswered) {
                        if (opt === currentQuestion?.correctAnswer) btnClass += " correct-anim";
                        else if (opt === selectedOption) btnClass += " wrong-anim";
                    }
                    return (
                        <button 
                            key={idx} 
                            className={btnClass}
                            onClick={() => handleAnswer(opt)}
                            disabled={isAnswered}
                            dir="auto"
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>

      </div>
    </div>
  );
}
