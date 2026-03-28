// ============================================
// SERVER.JS — Signaling Server (Node.js)
// À déployer sur Railway, Render, ou un VPS
// ============================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // En production, mets l'URL de ton frontend
    methods: ["GET", "POST"],
  },
});

// File d'attente des utilisateurs en attente d'un match
let waitingUsers = [];

// Map : socketId → roomId
const userRooms = new Map();

io.on("connection", (socket) => {
  console.log(`✅ Connecté: ${socket.id}`);

  // Un utilisateur cherche un match
  socket.on("find_match", () => {
    console.log(`🔍 ${socket.id} cherche un match. File: ${waitingUsers.length}`);

    // Retirer l'utilisateur s'il était déjà en attente
    waitingUsers = waitingUsers.filter((id) => id !== socket.id);

    if (waitingUsers.length > 0) {
      // Un partenaire est disponible
      const partnerId = waitingUsers.shift();
      const roomId = `room_${socket.id}_${partnerId}`;

      // Enregistrer les rooms
      userRooms.set(socket.id, roomId);
      userRooms.set(partnerId, roomId);

      // Rejoindre la room
      socket.join(roomId);
      io.sockets.sockets.get(partnerId)?.join(roomId);

      // Notifier les deux utilisateurs
      // L'initiateur (socket.id) va créer l'offre WebRTC
      socket.emit("match_found", { roomId, isInitiator: true });
      io.to(partnerId).emit("match_found", { roomId, isInitiator: false });

      console.log(`🎉 Match: ${socket.id} ↔ ${partnerId} dans ${roomId}`);
    } else {
      // Mettre en file d'attente
      waitingUsers.push(socket.id);
      socket.emit("waiting");
      console.log(`⏳ ${socket.id} en attente...`);
    }
  });

  // Relayer les messages WebRTC (offer, answer, ice candidates)
  socket.on("webrtc_offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("webrtc_offer", { offer });
  });

  socket.on("webrtc_answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("webrtc_answer", { answer });
  });

  socket.on("webrtc_ice_candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("webrtc_ice_candidate", { candidate });
  });

  // Un utilisateur swipe (passe à la personne suivante)
  socket.on("skip", () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      // Notifier le partenaire qu'il a été skippé
      socket.to(roomId).emit("partner_skipped");

      // Quitter la room
      socket.leave(roomId);
      userRooms.delete(socket.id);

      // Remettre l'utilisateur dans la file
      socket.emit("waiting");
      if (!waitingUsers.includes(socket.id)) {
        waitingUsers.push(socket.id);
      }
    }
  });

  // Déconnexion
  socket.on("disconnect", () => {
    console.log(`❌ Déconnecté: ${socket.id}`);

    // Retirer de la file d'attente
    waitingUsers = waitingUsers.filter((id) => id !== socket.id);

    // Notifier le partenaire si en call
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit("partner_disconnected");
      userRooms.delete(socket.id);
    }
  });
});

// Health check endpoint
app.get("/", (req, res) => res.send("Serveur Signaling actif ✅"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
