// server.js
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// 1) Charger les fichiers JSON en mémoire
const themes = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "themes.json"), "utf8"));
const allQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "questions.json"), "utf8"));

// Sert le dossier public
app.use(express.static(__dirname + "/public"));

// Stockage en mémoire des salles
let rooms = {};

/**
 * Génère un identifiant de salle unique.
 */
function generateRoomId() {
  return Math.random().toString(36).substr(2, 6);
}

/**
 * Retourne la liste des salles disponibles (parties non démarrées)
 */
function getAvailableRooms() {
  let available = [];
  for (let roomId in rooms) {
    if (!rooms[roomId].gameStarted) {
      const hostPlayer = rooms[roomId].players.find(p => p.isHost);
      available.push({ roomId, hostPseudo: hostPlayer ? hostPlayer.pseudo : "Inconnu" });
    }
  }
  return available;
}

/**
 * Génère la playlist de nbQuestions questions, en piochant aléatoirement
 * parmi les thèmes sélectionnés et en évitant les doublons pour certains types.
 */
function generatePlaylist(selectedThemes, nbQuestions) {
  // Pour éviter que les questions "image", "audio" ou "texte" ne repassent,
  // on maintient un ensemble de questions déjà utilisées par thème (index)
  const usedQuestionsByTheme = {};
  selectedThemes.forEach(t => {
    usedQuestionsByTheme[t] = new Set(); // On stockera l'attribut "numero" des questions déjà prises
  });

  const playlist = [];

  for (let i = 0; i < nbQuestions; i++) {
    // 1) Choix d'un thème aléatoire parmi ceux sélectionnés
    const randomThemeIndex = selectedThemes[Math.floor(Math.random() * selectedThemes.length)];
    
    // Récupérer l'objet thème (pour connaître son type)
    const themeObj = themes.find(th => th.index === randomThemeIndex);
    if (!themeObj) {
      console.warn("Thème introuvable pour l'index", randomThemeIndex);
      continue;
    }

    const themeType = themeObj.type;
    let questionObj = null;

    // 2) Selon le type, on pioche différemment
    switch (themeType) {
      case "image":
      case "audio":
      case "texte": {
        // On pioche UNE question, en évitant les doublons
        questionObj = pickRandomQuestionAvoidingDuplicates(randomThemeIndex, usedQuestionsByTheme);
        if (!questionObj) {
          // S'il n'y a plus de questions dispo, on saute
          console.warn("Plus de questions disponibles pour le thème", randomThemeIndex);
          continue;
        }
        // On crée un objet de playlist minimal
        playlist.push({
          type: themeType,
          themeIndex: randomThemeIndex,
          questionData: questionObj
        });
        break;
      }
      case "classement": {
        // On pioche 4 questions (les doublons sont autorisés d'une question sur l'autre, 
        // donc on n'utilise PAS usedQuestionsByTheme)
        const possible = allQuestions[randomThemeIndex] || [];
        const picked = pickNRandom(possible, 4);
        playlist.push({
          type: "classement",
          themeIndex: randomThemeIndex,
          questions: picked
        });
        break;
      }
      case "enumeration": {
        // On pioche 6 questions + 1 lettre aléatoire entre A..U
        const possible = allQuestions[randomThemeIndex] || [];
        const picked = pickNRandom(possible, 6);
        // Lettre aléatoire
        const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 21)); // 65='A', +21 => 'U'
        playlist.push({
          type: "enumeration",
          themeIndex: randomThemeIndex,
          questions: picked,
          letter: randomLetter
        });
        break;
      }
      default:
        console.warn("Type de thème inconnu :", themeType);
        break;
    }
  }
  
  return playlist;
}

/**
 * Pioche une question aléatoire pour un thème "image", "audio" ou "texte",
 * en évitant celles déjà utilisées dans usedQuestionsByTheme[themeIndex].
 * Retourne null s'il n'y a plus de question disponible.
 */
function pickRandomQuestionAvoidingDuplicates(themeIndex, usedQuestionsByTheme) {
  const possible = allQuestions[themeIndex] || [];
  // Filtre celles qui ne sont pas déjà utilisées
  const available = possible.filter(q => !usedQuestionsByTheme[themeIndex].has(q.numero));
  if (available.length === 0) {
    return null;
  }
  // Choix aléatoire
  const randQ = available[Math.floor(Math.random() * available.length)];
  // Marquer comme utilisée
  usedQuestionsByTheme[themeIndex].add(randQ.numero);
  return randQ;
}

/**
 * Retourne un sous-tableau de n questions prises aléatoirement dans "arr".
 * S'il y a moins d'éléments que n, on prend tout (ou un sous-ensemble si duplication possible).
 */
function pickNRandom(arr, n) {
  // On clone l'array
  const clone = [...arr];
  // On mélange
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  // On prend les n premiers
  return clone.slice(0, n);
}



// SOCKET.IO
io.on("connection", (socket) => {
  console.log(`Nouveau client connecté : ${socket.id}`);

  // Création de salle par l'hôte
  socket.on("createRoom", (data) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      host: socket.id,
      gameStarted: false,
      settings: data.settings || {},
      players: []
    };
    // Ajoute l'hôte dans la liste des joueurs
    rooms[roomId].players.push({
      socketId: socket.id,
      pseudo: data.pseudo,
      isHost: true
    });
    socket.join(roomId);
    socket.emit("roomCreated", { roomId, roomData: rooms[roomId] });
    io.emit("availableRooms", getAvailableRooms());
    io.to(roomId).emit("updatePlayers", rooms[roomId].players);
  });

  // Un joueur rejoint une salle existante
  socket.on("joinRoom", (data) => {
    const roomId = data.roomId;
    if (rooms[roomId] && !rooms[roomId].gameStarted) {
      socket.join(roomId);
      rooms[roomId].players.push({
        socketId: socket.id,
        pseudo: data.pseudo,
        isHost: false
      });
      io.to(roomId).emit("updatePlayers", rooms[roomId].players);
    } else {
      socket.emit("error", { message: "Salle introuvable ou la partie a déjà commencé." });
    }
  });

  // Mise à jour des réglages (nbQuestions, selectedThemes, etc.)
  socket.on("updateSettings", (data) => {
    const { roomId, nbQuestions, selectedThemes } = data;
    const room = rooms[roomId];
    if (!room) return;

    if (room.host !== socket.id) {
      console.log("Un joueur non-hôte a tenté de modifier les settings.");
      return;
    }
    room.settings.nbQuestions = nbQuestions;
    room.settings.selectedThemes = selectedThemes;

    // On notifie tous les joueurs de la salle
    io.to(roomId).emit("updateSettings", room.settings);
  });

  // Quand le client demande la liste des salles disponibles
  socket.on("getAvailableRooms", () => {
    socket.emit("availableRooms", getAvailableRooms());
  });

  // L'hôte démarre la partie
  socket.on("startGame", (data) => {
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    if (room.host === socket.id) {
      const nbQuestions = room.settings.nbQuestions || 3;
      const selectedThemes = room.settings.selectedThemes || [];

      // Générer la playlist
      const playlist = generatePlaylist(selectedThemes, nbQuestions);

      // Vérifier qu'on a assez de questions
      if (playlist.length < nbQuestions) {
        socket.emit("error", { message: "Impossible de lancer la partie : pas assez de questions disponibles." });
        return;
      }

      room.gameStarted = true;
      room.playlist = playlist;
      // On stocke un objet answers pour conserver les réponses :
      room.answers = {}; 
      // Par exemple : room.answers[questionIndex] = { socketId: "réponse" }
      room.scores = {};
      room.players.forEach(p => {
        room.scores[p.socketId] = 0;
      });

      // On émet "gameStarted" pour signaler le début global
      io.to(roomId).emit("gameStarted", {});

      // On lance la première question
      startQuestion(roomId, 0);
    } else {
      socket.emit("error", { message: "Seul l'hôte peut démarrer la partie." });
    }
  });

  socket.on("validateAnswer", (data) => {
    // data = { roomId, questionIndex, playerId, points }
    const { roomId, questionIndex, playerId, points } = data;
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;
    
    // Vérifier que c'est l'hôte qui envoie cet événement
    if (room.host !== socket.id) {
      console.log("Un non-hôte tente de valider une réponse");
      return;
    }
    
    // On ajoute les points au score du joueur
    if (room.scores[playerId] == null) {
      room.scores[playerId] = 0;
    }
    room.scores[playerId] += points;
  
    // On peut émettre un événement "scoreUpdate" pour que tout le monde voie les scores en direct
    io.to(roomId).emit("scoreUpdate", {
      scores: room.scores
    });
  });

  socket.on("endCorrection", (data) => {
    // data = { roomId }
    const { roomId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id) return; // Seul l'hôte
  
    // Construire un array "classement" depuis room.scores
    const players = room.players.map(p => {
      return {
        pseudo: p.pseudo,
        score: room.scores[p.socketId] || 0
      };
    });
  
    // On trie par ordre décroissant de score
    players.sort((a, b) => b.score - a.score);
  
    io.to(roomId).emit("finalResults", { ranking: players });
  });

  // Réception de la réponse d'un joueur
  socket.on("submitAnswer", (data) => {
    const { roomId, questionIndex, answer } = data;
    const room = rooms[roomId];
    if (!room || !room.playlist) return;

    // On stocke la réponse
    if (!room.answers[questionIndex]) {
      room.answers[questionIndex] = {};
    }
    room.answers[questionIndex][socket.id] = answer;
  
  });

  socket.on("toggleCorrectness", (data) => {
    // data = { roomId, questionIndex, playerId, correctness }
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
  
    // Vérifier que c'est l'hôte qui émet
    if (room.host !== socket.id) {
      return;
    }
    io.to(roomId).emit("toggleCorrectness", data);
  });

  socket.on("updateCorrectionState", (data) => {
    // data = { roomId, questionIndex, playerIndex }
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
  
    // Seul l’hôte doit pouvoir envoyer cet événement
    if (room.host !== socket.id) {
      return;
    }
  
    // On relaie l’état à tous les joueurs
    io.to(roomId).emit("updateCorrectionState", data);
  });

  // Gestion de la déconnexion d'un joueur
  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    for (let roomId in rooms) {
      let room = rooms[roomId];
      const index = room.players.findIndex(player => player.socketId === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(roomId).emit("updatePlayers", room.players);
        if (room.players.length === 0) {
          delete rooms[roomId];
          io.emit("availableRooms", getAvailableRooms());
        } else if (room.host === socket.id) {
          room.host = room.players[0].socketId;
          room.players[0].isHost = true;
          io.to(roomId).emit("updatePlayers", room.players);
        }
      }
    }
  });
});

function startQuestion(roomId, questionIndex) {
  const room = rooms[roomId];
  if (!room) return;

  // Si on est déjà au-delà de la dernière question, on termine la partie
  if (questionIndex >= room.playlist.length) {
    io.to(roomId).emit("endGame", {
      playlist: room.playlist,
      answers: room.answers
    });
    return; // <-- On sort, sans rien faire de plus
  }

  const currentQuestion = room.playlist[questionIndex];

  // Durée selon le type
  let duration = 20;
  if (currentQuestion.type === "classement") duration = 30;
  if (currentQuestion.type === "enumeration") duration = 40;

  // On informe les joueurs de la nouvelle question
  io.to(roomId).emit("newQuestion", {
    questionIndex,
    questionData: currentQuestion,
    total: room.playlist.length,
    duration
  });

  // Au bout de [duration] secondes, on passe à la question suivante
  room.questionTimer = setTimeout(() => {
    // On notifie la fin de la question
    io.to(roomId).emit("endQuestion", { questionIndex });
    // On appelle startQuestion pour la question suivante

    if (questionIndex + 1 >= room.playlist.length) {
      // On attend un petit délai avant endGame
      setTimeout(() => {
        io.to(roomId).emit("endGame", {
          playlist: room.playlist,
          answers: room.answers
        });
      }, 1000);
    } else {
      startQuestion(roomId, questionIndex + 1);
    }
      }, duration * 1000);
}

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
