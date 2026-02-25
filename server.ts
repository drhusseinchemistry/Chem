
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
  });

  const PORT = 3000;

  // Game State
  interface Player {
    id: string;
    name: string;
    team: 1 | 2; // 1: Right (Blue), 2: Left (Red)
  }

  interface Room {
    id: string;
    players: Player[];
    ropePosition: number;
    gameStarted: boolean;
  }

  const rooms: Record<string, Room> = {};

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join_room", ({ roomId, name }: { roomId: string; name: string }) => {
      if (!rooms[roomId]) {
        rooms[roomId] = {
          id: roomId,
          players: [],
          ropePosition: 50,
          gameStarted: false,
        };
      }

      const room = rooms[roomId];
      
      // Check if room is full
      if (room.players.length >= 2) {
        socket.emit("room_full");
        return;
      }

      // Assign team: first player is Team 1 (Right/Blue), second is Team 2 (Left/Red)
      const team = room.players.length === 0 ? 1 : 2;
      const player: Player = { id: socket.id, name, team };
      
      room.players.push(player);
      socket.join(roomId);

      // Notify everyone in the room about the updated player list
      io.to(roomId).emit("player_joined", { players: room.players });
      socket.emit("joined_success", { player });

      // If we have 2 players, we can let them know they are ready to start
      if (room.players.length === 2) {
        io.to(roomId).emit("ready_to_start");
      }
    });

    socket.on("start_game", ({ roomId }) => {
      if (rooms[roomId] && rooms[roomId].players.length === 2) {
        rooms[roomId].gameStarted = true;
        rooms[roomId].ropePosition = 50;
        io.to(roomId).emit("game_started");
      }
    });

    socket.on("update_score", ({ roomId, delta }: { roomId: string; delta: number }) => {
      const room = rooms[roomId];
      if (room && room.gameStarted) {
        room.ropePosition += delta;
        
        // Clamp values
        if (room.ropePosition > 95) room.ropePosition = 95;
        if (room.ropePosition < 5) room.ropePosition = 5;

        io.to(roomId).emit("state_update", { ropePosition: room.ropePosition });

        // Check win condition
        // In original code: 
        // Team 1 (Right) wins if pos >= 90
        // Team 2 (Left) wins if pos <= 10
        if (room.ropePosition >= 90) {
           const winner = room.players.find(p => p.team === 1);
           io.to(roomId).emit("game_over", { winnerName: winner?.name || "Team 1" });
           room.gameStarted = false;
        } else if (room.ropePosition <= 10) {
           const winner = room.players.find(p => p.team === 2);
           io.to(roomId).emit("game_over", { winnerName: winner?.name || "Team 2" });
           room.gameStarted = false;
        }
      }
    });

    // WebRTC Signaling
    socket.on("offer", (payload) => {
      io.to(payload.target).emit("offer", payload);
    });

    socket.on("answer", (payload) => {
      io.to(payload.target).emit("answer", payload);
    });

    socket.on("ice-candidate", (payload) => {
      io.to(payload.target).emit("ice-candidate", payload);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected", socket.id);
      // Clean up rooms
      for (const roomId in rooms) {
        const room = rooms[roomId];
        const index = room.players.findIndex((p) => p.id === socket.id);
        if (index !== -1) {
          room.players.splice(index, 1);
          io.to(roomId).emit("player_left", { players: room.players });
          
          if (room.players.length === 0) {
            delete rooms[roomId];
          } else {
            // If one player leaves, end the game
            room.gameStarted = false;
            io.to(roomId).emit("opponent_left");
          }
          break;
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(__dirname, "dist")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
