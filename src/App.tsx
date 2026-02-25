
import React, { useState, useEffect, useRef } from 'react';
import { Peer, DataConnection, MediaConnection } from 'peerjs';
import { defaultQuizData } from './data';
import './Game.css';
import { Mic, MicOff, Phone, Share2 } from 'lucide-react';

// --- Types ---
interface Player {
  id: string; // Peer ID
  name: string;
  team: 1 | 2;
}

interface Question {
  text: string;
  options: string[];
  correctAnswer: string;
}

interface GameState {
  ropePosition: number;
  winnerName: string | null;
  gameStarted: boolean;
}

// Data Packet Types
type DataPacket = 
  | { type: 'JOIN_REQUEST'; name: string }
  | { type: 'JOIN_ACCEPT'; players: Player[]; gameState: GameState }
  | { type: 'PLAYER_JOINED'; player: Player }
  | { type: 'GAME_START' }
  | { type: 'STATE_UPDATE'; ropePosition: number }
  | { type: 'GAME_OVER'; winnerName: string }
  | { type: 'OPPONENT_LEFT' };

export default function App() {

  // --- State ---
  const [view, setView] = useState<'lobby' | 'countdown' | 'game' | 'win'>('lobby');
  const [isConnecting, setIsConnecting] = useState(false);
  
  // PeerJS
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [hostPeerId, setHostPeerId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null); // For guest: connection to host. For host: connection to guest.
  
  // Game Data
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
  const localStream = useRef<MediaStream | null>(null);
  const callRef = useRef<MediaConnection | null>(null);

  // --- Initialization ---

  useEffect(() => {
    // 1. Initialize Peer with STUN servers for better connectivity
    const peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('My Peer ID is: ' + id);
      setMyPeerId(id);
      
      // Check URL for room (host ID)
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam) {
        setHostPeerId(roomParam);
      }
    });

    peer.on('connection', (conn) => {
      // Handle incoming data connection
      conn.on('data', (data) => handleData(data as DataPacket, conn));
      conn.on('open', () => {
          console.log("Connection opened with", conn.peer);
          if (!connRef.current) connRef.current = conn; 
      });
      conn.on('close', () => {
          alert("Opponent disconnected");
          window.location.reload();
      });
      conn.on('error', (err) => {
          console.error("Connection error:", err);
      });
    });

    peer.on('error', (err) => {
        console.error("Peer error:", err);
        if (err.type === 'peer-unavailable') {
            alert("Room not found or host is offline. Please check the link.");
            setIsConnecting(false);
        } else {
            // alert("Connection error: " + err.type);
        }
    });

    peer.on('call', (call) => {
      // Answer incoming voice call automatically
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        localStream.current = stream;
        if (localAudioRef.current) {
            localAudioRef.current.srcObject = stream;
            localAudioRef.current.muted = true; // Mute local echo
        }
        
        call.answer(stream); // Answer the call with an A/V stream.
        call.on('stream', (remoteStream) => {
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = remoteStream;
            }
        });
        callRef.current = call;
        setIsVoiceConnected(true);
      }).catch(err => {
          console.error("Failed to get local stream", err);
      });
    });

    return () => {
      peer.destroy();
    };
  }, []);

  // --- Data Handling ---

  const handleData = (data: DataPacket, conn: DataConnection) => {
    console.log("Received data:", data);
    
    switch (data.type) {
      case 'JOIN_REQUEST':
        // I am Host, received join request
        if (players.length >= 2) return; // Room full
        
        const newPlayer: Player = { id: conn.peer, name: data.name, team: 2 };
        const updatedPlayers = [...players, newPlayer];
        setPlayers(updatedPlayers);
        
        // Send Accept
        conn.send({ 
            type: 'JOIN_ACCEPT', 
            players: updatedPlayers,
            gameState: { ropePosition, winner: null, gameStarted: false }
        });
        
        // Save connection
        connRef.current = conn;
        break;

      case 'JOIN_ACCEPT':
        // I am Guest, received acceptance
        setIsConnecting(false); // Stop loading
        setPlayers(data.players);
        setRopePosition(data.gameState.ropePosition);
        setMyTeam(2); // Guest is always Team 2 (Left/Red)
        connRef.current = conn;
        break;

      case 'GAME_START':
        startCountdown();
        break;

      case 'STATE_UPDATE':
        setRopePosition(data.ropePosition);
        break;

      case 'GAME_OVER':
        setWinnerName(data.winnerName);
        setView('win');
        break;
        
      case 'OPPONENT_LEFT':
        alert("Opponent left!");
        window.location.reload();
        break;
    }
  };

  // --- Actions ---

  const createRoom = () => {
    if (!playerName) return alert("Please enter name");
    setIsHost(true);
    setMyTeam(1); // Host is Team 1 (Right/Blue)
    const me: Player = { id: myPeerId, name: playerName, team: 1 };
    setPlayers([me]);
    // URL update
    const url = new URL(window.location.href);
    url.searchParams.set('room', myPeerId);
    window.history.pushState({}, '', url.toString());
  };

  const joinRoom = () => {
    if (!playerName) return alert("Please enter name");
    if (!hostPeerId) return alert("No Room ID found");
    
    setIsConnecting(true); // Show loading state

    // Wait a bit to ensure peer is ready if it wasn't
    if (!peerRef.current || !peerRef.current.id) {
        alert("Connection not ready yet. Please wait a few seconds and try again.");
        setIsConnecting(false);
        return;
    }
    
    const conn = peerRef.current.connect(hostPeerId, {
        reliable: true
    });

    if (conn) {
        conn.on('open', () => {
            console.log("Connected to host, sending join request...");
            conn.send({ type: 'JOIN_REQUEST', name: playerName });
        });
        conn.on('data', (data) => handleData(data as DataPacket, conn));
        conn.on('error', (err) => {
            console.error("Connection error:", err);
            alert("Failed to connect to host.");
            setIsConnecting(false);
        });
        conn.on('close', () => {
             setIsConnecting(false);
        });
        connRef.current = conn;
        
        // Timeout if no response
        setTimeout(() => {
            if (players.length === 0) {
                // If we haven't joined yet (players list empty)
                setIsConnecting(false);
                alert("Connection timed out. Host might be offline or busy.");
            }
        }, 10000);
    }
  };

  const startGame = () => {
    if (connRef.current) {
        connRef.current.send({ type: 'GAME_START' });
        startCountdown();
    }
  };

  const startCountdown = () => {
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

    // Update local state
    let newPos = ropePosition + delta;
    if (newPos > 95) newPos = 95;
    if (newPos < 5) newPos = 5;
    setRopePosition(newPos);

    // Send update
    if (connRef.current) {
        connRef.current.send({ type: 'STATE_UPDATE', ropePosition: newPos });
    }

    // Check Win
    if (newPos >= 90) {
        const winner = players.find(p => p.team === 1)?.name || "Team 1";
        finishGame(winner);
    } else if (newPos <= 10) {
        const winner = players.find(p => p.team === 2)?.name || "Team 2";
        finishGame(winner);
    } else {
        setTimeout(() => {
            loadNextQuestion();
        }, 1000);
    }
  };

  const finishGame = (winner: string) => {
      setWinnerName(winner);
      setView('win');
      if (connRef.current) {
          connRef.current.send({ type: 'GAME_OVER', winnerName: winner });
      }
  };

  // --- Voice Chat ---

  const startVoiceCall = () => {
      if (!connRef.current) return;
      
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
          localStream.current = stream;
          if (localAudioRef.current) {
              localAudioRef.current.srcObject = stream;
              localAudioRef.current.muted = true;
          }
          
          const call = peerRef.current?.call(connRef.current!.peer, stream);
          if (call) {
              call.on('stream', (remoteStream) => {
                  if (remoteAudioRef.current) {
                      remoteAudioRef.current.srcObject = remoteStream;
                  }
              });
              callRef.current = call;
              setIsVoiceConnected(true);
          }
      }).catch(err => {
          console.error("Mic error", err);
          alert("Could not access microphone");
      });
  };

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const copyInvite = () => {
    const url = `${window.location.origin}?room=${myPeerId}`;
    navigator.clipboard.writeText(url);
    alert("Link copied! Send it to your friend.");
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

            {/* If URL has room, show Join button. Else show Create button */}
            {hostPeerId ? (
                <button className="btn-start-game" onClick={joinRoom} disabled={isConnecting}>
                    {isConnecting ? "Connecting..." : "Join Game"}
                </button>
            ) : (
                !isHost ? (
                    <button className="btn-copy-link" onClick={createRoom}>
                        Create New Room
                    </button>
                ) : (
                    <div style={{marginTop: '10px'}}>
                        <p style={{color: 'green'}}>Room Created! Waiting for friend...</p>
                        <button className="btn-copy-link" onClick={copyInvite} style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', margin: '10px auto'}}>
                            <Share2 size={16}/> Copy Invite Link
                        </button>
                    </div>
                )
            )}

            {players.length > 0 && (
                <div style={{ marginTop: '20px', textAlign: 'left' }}>
                    <h3>Players:</h3>
                    <ul>
                        {players.map(p => (
                            <li key={p.id} style={{ color: p.team === 1 ? '#1565c0' : '#c62828' }}>
                                {p.name} {p.id === myPeerId ? '(You)' : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {players.length === 2 && isHost && (
                <button className="btn-start-game" onClick={startGame}>
                    دەستپێکردن
                </button>
            )}
            {players.length === 2 && !isHost && (
                <p>Waiting for host to start...</p>
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
                    <button className="voice-btn" onClick={startVoiceCall} title="Join Voice Chat">
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
