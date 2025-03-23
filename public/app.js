// public/app.js

// Connexion au serveur Socket.io
const socket = io();

document.addEventListener("DOMContentLoaded", function() {
  const pseudoInput = document.getElementById("pseudoInput");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const joinRoomBtn = document.getElementById("joinRoomBtn");
  
  const homeScreen = document.getElementById("homeScreen");
  const createRoomScreen = document.getElementById("createRoomScreen");
  const joinRoomScreen = document.getElementById("joinRoomScreen");
  
  const playersList = document.getElementById("playersList");
  const themesList = document.getElementById("themesList");
  const toggleThemesBtn = document.getElementById("toggleThemes");
  const nbQuestionsInput = document.getElementById("nbQuestions");
  const startGameBtn = document.getElementById("startGameBtn");
  const availableRoomsDiv = document.getElementById("availableRooms");

  // Éléments pour l'écran de question
  const questionScreen = document.getElementById("questionScreen");
  const questionContent = document.getElementById("questionContent");
  const answerArea = document.getElementById("answerArea");
  const timerCircle = document.getElementById("timerCircle");
  const timerValue = document.getElementById("timerValue");

  let myPseudo = "";
  let currentRoomId = null;
  let iAmHost = false;
  let currentQuestionIndex = 0;
  let gameInProgress = false;
  let currentPlayers = [];
  
  // On gardera la dernière question reçue pour collecter la bonne réponse
  let lastQuestionData = null;

  // timerInterval servira pour le timer local
  let timerInterval = null;

  // ========== Événements "Accueil / Création / Rejoindre" ==========

  pseudoInput.addEventListener("input", function() {
    const value = pseudoInput.value.trim();
    createRoomBtn.disabled = value === "";
    joinRoomBtn.disabled = value === "";
  });

  // Quand on clique sur "Créer une salle"
  createRoomBtn.addEventListener("click", function() {
    myPseudo = pseudoInput.value.trim();

    // 1) On informe le serveur
    socket.emit("createRoom", {
      pseudo: myPseudo,
      settings: {
        nbQuestions: parseInt(nbQuestionsInput.value, 10) || 3, 
        selectedThemes: []
      }
    });

    // 2) On masque l'accueil, on affiche l'écran de création
    homeScreen.classList.add("hidden");
    createRoomScreen.classList.remove("hidden");

    // 3) On se considère hôte localement
    iAmHost = true;
    toggleUIForHost(true);

    // 4) On affiche déjà notre pseudo dans la liste
    playersList.innerHTML = "";
    const playerDiv = document.createElement("div");
    playerDiv.textContent = myPseudo + " (hôte)";
    playersList.appendChild(playerDiv);

    // 5) On charge la liste de thèmes
    loadThemes().then(() => {
      const checkboxes = themesList.querySelectorAll("input[type='checkbox']");
      checkboxes.forEach(cb => {
        cb.checked = true;
      });
    });
  });

  // Bouton "Tout sélectionner / Tout désélectionner"
  toggleThemesBtn.addEventListener("click", function() {
    const checkboxes = themesList.querySelectorAll("input[type='checkbox']");
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
    });
    toggleThemesBtn.textContent = allChecked ? "🐸" : "🐸";

    // Comme l'hôte vient de changer les thèmes, on informe le serveur
    sendUpdatedSettings();
  });

  nbQuestionsInput.addEventListener("change", function() {
    if (iAmHost) {
      sendUpdatedSettings();
    }
  });

  joinRoomBtn.addEventListener("click", function() {
    myPseudo = pseudoInput.value.trim();
    
    homeScreen.classList.add("hidden");
    joinRoomScreen.classList.remove("hidden");

    // On demande au serveur la liste des salles disponibles
    socket.emit("getAvailableRooms");
  });

  // ========== Événements Socket côté client ==========

  // Liste des salles
  socket.on("availableRooms", (rooms) => {
    availableRoomsDiv.innerHTML = "";
    if (rooms.length === 0) {
      availableRoomsDiv.textContent = "Aucune salle disponible pour le moment.";
      return;
    }
    rooms.forEach(room => {
      const salleDiv = document.createElement("div");
      salleDiv.classList.add("salle");
      salleDiv.textContent = `Salle de ${room.hostPseudo} (ID: ${room.roomId})`;
      
      salleDiv.addEventListener("click", function() {
        socket.emit("joinRoom", {
          roomId: room.roomId,
          pseudo: myPseudo
        });
        currentRoomId = room.roomId;
      });
      availableRoomsDiv.appendChild(salleDiv);
    });
  });

  // Création de salle confirmée
  socket.on("roomCreated", (data) => {
    currentRoomId = data.roomId;
  });

  // Mise à jour de la liste des joueurs
  socket.on("updatePlayers", (players) => {
    if (gameInProgress) {
      return;
    }
    if (themesList.children.length === 0) {
      loadThemes().then(() => {
        showLobby(players);
      });
    } else {
      showLobby(players);
    }
  });

  socket.on("updateCorrectionState", (data) => {
    if (iAmHost) return;
    // data = { roomId, questionIndex, playerIndex }
    correctionCurrentQuestionIndex = data.questionIndex;
    correctionCurrentPlayerIndex = data.playerIndex;
    showCorrectionQuestion();
  });

  function showLobby(players) {
    joinRoomScreen.classList.add("hidden");
    createRoomScreen.classList.remove("hidden");
  
    playersList.innerHTML = "";
    players.forEach(p => {
      const div = document.createElement("div");
      div.textContent = p.pseudo + (p.isHost ? " (hôte)" : "");
      playersList.appendChild(div);

      if (p.pseudo === myPseudo) {
        iAmHost = !!p.isHost;
      }
    });
    currentPlayers = players
    toggleUIForHost(iAmHost);
  }

  // Mise à jour des settings
  socket.on("updateSettings", (settings) => {
    nbQuestionsInput.value = settings.nbQuestions || 3;
    const checkboxes = themesList.querySelectorAll("input[type='checkbox']");
    checkboxes.forEach(cb => { cb.checked = false; });
  
    if (Array.isArray(settings.selectedThemes)) {
      settings.selectedThemes.forEach(themeIndex => {
        const cb = document.getElementById("theme-" + themeIndex);
        if (cb) {
          cb.checked = true;
        }
      });
    }
  });

  // Affichage d'erreurs
  socket.on("error", (data) => {
    alert("Erreur: " + data.message);
  });

  // Bouton "Commencer"
  startGameBtn.addEventListener("click", function() {
    if (!iAmHost) return;
    socket.emit("startGame", {
      roomId: currentRoomId
    });
  });

  // Quand la partie commence
  socket.on("gameStarted", () => {
    gameInProgress = true;
    // On masque l'écran de création, etc.
    createRoomScreen.classList.add("hidden");
    joinRoomScreen.classList.add("hidden");
    homeScreen.classList.add("hidden");
    questionScreen.classList.remove("hidden");
  });
  
  // Réception d'une nouvelle question
  socket.on("newQuestion", (data) => {
    // data = { questionIndex, questionData, total, duration }

    currentQuestionIndex = data.questionIndex;
    lastQuestionData = data.questionData;

    // On réinitialise l'affichage
    questionContent.innerHTML = "";
    answerArea.innerHTML = "";

    // On lance un timer local purement visuel
    startLocalTimer(data.duration);

    // On affiche la question selon son type
    displayQuestion(data.questionData, data.questionIndex + 1, data.total);
  });

  // Fin de la question : le serveur nous dit "endQuestion"
  socket.on("endQuestion", (data) => {
    // data.questionIndex
    if (data.questionIndex === currentQuestionIndex) {
      // On collecte la réponse courante et on l'envoie
      const answer = collectUserAnswer();
      socket.emit("submitAnswer", {
        roomId: currentRoomId,
        questionIndex: currentQuestionIndex,
        answer
      });
    }
  });

  socket.on("endGame", (data) => {
    // data = { playlist, answers }
    // On va passer en mode "correction"
  
    // On masque l'écran de question et on affiche l'écran de correction
    questionScreen.classList.add("hidden");
    correctionScreen.classList.remove("hidden");
  
    // On démarre la correction
    startCorrection(data.playlist, data.answers);
  });


  socket.on("finalResults", (data) => {
    // data.ranking = [ { pseudo, score }, ... ] triés
    correctionScreen.classList.add("hidden");
    resultsScreen.classList.remove("hidden");
    const reversedRanking = data.ranking.slice().reverse();
    animateResults(reversedRanking);
  });


  socket.on("toggleCorrectness", (data) => {
    // data = { roomId, questionIndex, playerId, correctness, subIndex? }
    // On construit un sélecteur pour trouver le bouton
    // Ex: .toggle-correctness[data-question-index="2"][data-player-id="socketId"] si subIndex non défini
    // ou on inclut subIndex si c'est enumeration
    let selector = `.toggle-correctness[data-question-index="${data.questionIndex}"][data-player-id="${data.playerId}"]`;
    if (data.subIndex !== undefined) {
      selector += `[data-sub-index="${data.subIndex}"]`;
    }
  
    const toggleBtn = document.querySelector(selector);
    if (!toggleBtn) return; // le bouton n'existe pas ou plus ?
  
    if (data.correctness) {
      toggleBtn.textContent = "VRAI";
      toggleBtn.style.backgroundColor = "green";
    } else {
      toggleBtn.textContent = "FAUX";
      toggleBtn.style.backgroundColor = "red";
    }
  });

  // ========== Fonctions utilitaires ==========

  /**
   * Charge la liste des thèmes depuis themes.json et les insère dans themesList
   */
  function loadThemes() {
    return fetch("themes.json")
      .then(response => response.json())
      .then(data => {
        themesList.innerHTML = "";
        data.forEach(theme => {
          const label = document.createElement("label");
          label.classList.add("themeItem");   // si vous voulez conserver le style .themeItem
          
          // On met l'input dedans
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = "theme-" + theme.index;
          checkbox.checked = true;            // si vous voulez cocher par défaut
          
          // Le texte du thème
          const textSpan = document.createElement("span");
          textSpan.textContent = theme.nomtheme;
          
          // On assemble
          label.appendChild(checkbox);
          label.appendChild(textSpan);
          
          // On ajoute le label directement au "themesList"
          themesList.appendChild(label);

          // Chaque checkbox -> si on est hôte, on met à jour le serveur
          checkbox.addEventListener("change", function() {
            if (iAmHost) {
              sendUpdatedSettings();
            }
          });
        });
      })
      .catch(error => {
        console.error("Erreur lors du chargement des thèmes:", error);
      });
  }

  function animateResults(ranking) {
    rankingList.innerHTML = "";
    let i = 0;
  
    function addNextLine() {
      if (i >= ranking.length) return; // fini
  
      const player = ranking[i];
      const line = document.createElement("div");
      line.classList.add("resultLine");
  
      // Pseudo à gauche, score à droite
      line.innerHTML = `
        <span>${player.pseudo}</span>
        <span>${player.score}</span>
      `;
      // Au départ, opacity = 0 (défini dans CSS)
  
      // On insère la ligne
      rankingList.appendChild(line);
  
      // On déclenche le fade-in
      setTimeout(() => {
        line.style.opacity = "1";
      }, 50);
  
      i++;
      if (i < ranking.length) {
        setTimeout(addNextLine, 3000); // toutes les 4 secondes
      }
    }
  
    setTimeout(addNextLine, 1000);
  }

  /**
   * Envoie au serveur les settings mis à jour (nbQuestions, selectedThemes).
   */
  function sendUpdatedSettings() {
    if (!iAmHost || !currentRoomId) return;
    
    const nbQuestions = parseInt(nbQuestionsInput.value, 10) || 3;
    const selectedThemes = [];
    const checkboxes = themesList.querySelectorAll("input[type='checkbox']");
    checkboxes.forEach(cb => {
      if (cb.checked) {
        const index = cb.id.replace("theme-", "");
        selectedThemes.push(index);
      }
    });

    socket.emit("updateSettings", {
      roomId: currentRoomId,
      nbQuestions,
      selectedThemes
    });
  }

  /**
   * Timer local purement visuel (sans callback).
   * Le serveur gère le passage à la question suivante.
   */
  function startLocalTimer(duration) {
    clearInterval(timerInterval);
    
    // Si le serveur envoie 21, on veut afficher de 20 à 1
    let remaining = duration - 1;
    updateTimerDisplay(remaining, duration - 1);
  
    timerInterval = setInterval(() => {
      remaining -= 0.1;
      if (remaining <= 0) {
        clearInterval(timerInterval);
        updateTimerDisplay(0, duration - 1);
      } else {
        updateTimerDisplay(remaining, duration - 1);
      }
    }, 100);
  }
  
  function updateTimerDisplay(remaining, total) {
    const displayVal = Math.ceil(remaining);
    timerValue.textContent = displayVal;
  
    const fraction = remaining / total;
    const angle = 360 * fraction;
    timerCircle.style.background = `
      conic-gradient(
        #00aa00 ${angle}deg,
        #ddd ${angle}deg
      )
    `;
  }

  /**
   * Affiche la question selon son type (image, audio, texte, enumeration, classement)
   */
  function displayQuestion(qData, questionNumber, total) {
    switch (qData.type) {
      case "image":
      case "audio":
      case "texte":
        displaySingleQuestion(qData, questionNumber, total);
        break;
      case "enumeration":
        displayEnumerationQuestion(qData, questionNumber, total);
        break;
      case "classement":
        displayClassementQuestion(qData, questionNumber, total);
        break;
    }
  }

  /**
   * Question simple (image, audio, texte)
   */
  function displaySingleQuestion(qData, questionNumber, total) {
    // Titre
    const questionTitle = document.createElement("div");
    questionTitle.textContent = `Question ${questionNumber} : ${qData.questionData.question}`;
    questionTitle.classList.add("questionTitle");
    questionContent.appendChild(questionTitle);

    // Selon type
    if (qData.type === "image") {
      const img = document.createElement("img");
      img.src = qData.questionData.url;
      img.style.maxHeight = "50vh";
      questionContent.appendChild(img);
      img.addEventListener("click", (e) => {
        e.stopPropagation(); // empêche de déclencher le doc click ci-dessous
        if (!img.classList.contains("enlarged")) {
          // On agrandit
          img.classList.add("enlarged");
          // On écoute un clic sur le document (en dehors) pour refermer
          setTimeout(() => {
            document.addEventListener("click", docClick, { once: true });
          }, 0);
        } else {
          // On la remet à sa taille normale
          img.classList.remove("enlarged");
        }
      });
      
      // Fonction pour fermer l'image si on clique ailleurs
      function docClick() {
        // On remet l'image à sa taille normale
        img.classList.remove("enlarged");
      }
    }
    else if (qData.type === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = qData.questionData.url;
      questionContent.appendChild(audio);
    }
    else if (qData.type === "texte") {
      const texteQuestion = document.createElement("div");
      texteQuestion.textContent = `${qData.questionData.texte}`;
      texteQuestion.classList.add("texteQuestion");
      questionContent.appendChild(texteQuestion);
    }

    // Barre de réponse
    const answerInput = document.createElement("input");
    answerInput.type = "text";
    answerInput.placeholder = "Votre réponse...";
    answerInput.classList.add("answer-input");
    answerArea.appendChild(answerInput);
    answerInput.focus();
  }

  /**
   * Question enumeration
   */
  function displayEnumerationQuestion(qData, questionNumber, total) {
    const titleDiv = document.createElement("div");
    titleDiv.textContent = `Question ${questionNumber}`;
    titleDiv.classList.add("enumerationTitle");
    questionContent.appendChild(titleDiv);
  
    const letterDiv = document.createElement("div");
    letterDiv.textContent = qData.letter; // la lettre aléatoire
    letterDiv.classList.add("enumerationLetter");
    questionContent.appendChild(letterDiv);

    let firstInput = null; // variable pour mémoriser le premier champ

    qData.questions.forEach((subQ, i) => {
      const subQuestionDiv = document.createElement("div");
      subQuestionDiv.textContent = subQ.question;
      questionContent.appendChild(subQuestionDiv);

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Votre réponse...";
      input.dataset.index = i;
      input.classList.add("enumeration-input");
      questionContent.appendChild(input);

      if (i === 0) {
        firstInput = input;
      }  

      const br = document.createElement("br");
      questionContent.appendChild(br);
    });
    if (firstInput) {
      firstInput.focus();
    }
  }

  /**
   * Question classement
   */
  function displayClassementQuestion(qData, questionNumber, total) {
    const questionTitle = document.createElement("div");
    questionTitle.textContent = `Question ${questionNumber} : Thème = ${qData.themeIndex} (Classement)`;
    questionContent.appendChild(questionTitle);

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.justifyContent = "center";
    container.style.gap = "10px";
    questionContent.appendChild(container);

    // 4 sous-questions
    qData.questions.forEach((subQ, i) => {
      const block = document.createElement("div");
      block.style.width = "120px";
      block.style.height = "60px";
      block.style.overflow = "hidden";
      block.style.border = "1px solid #ccc";
      block.style.textOverflow = "ellipsis";
      block.style.whiteSpace = "pre-wrap";
      block.style.display = "flex";
      block.style.alignItems = "center";
      block.style.justifyContent = "center";

      let text = subQ.question || "";
      if (text.length > 50) {
        text = text.substring(0, 50) + "...";
      }
      block.textContent = text;
      container.appendChild(block);
    });

    const info = document.createElement("div");
    info.textContent = "Entrez l'ordre (ex: 2,1,4,3) :";
    answerArea.appendChild(info);

    const classementInput = document.createElement("input");
    classementInput.type = "text";
    classementInput.placeholder = "Ordre";
    answerArea.appendChild(classementInput);
    classementInput.focus();
  }

  /**
   * Récupère la réponse saisie par le joueur selon le type de la dernière question.
   */
  function collectUserAnswer() {
    if (!lastQuestionData) return "";

    switch (lastQuestionData.type) {
      case "image":
      case "audio":
      case "texte": {
        // On a mis un seul input dans answerArea
        const singleInput = answerArea.querySelector("input[type='text']");
        return singleInput ? singleInput.value.trim() : "";
      }
      case "enumeration": {
        // On a mis 6 inputs dans questionContent
        const inputs = questionContent.querySelectorAll("input[type='text']");
        const answers = [];
        inputs.forEach(inp => answers.push(inp.value.trim()));
        return answers;
      }
      case "classement": {
        // On a mis un input pour l'ordre dans answerArea
        const orderInput = answerArea.querySelector("input[type='text']");
        return orderInput ? orderInput.value.trim() : "";
      }
      default:
        return "";
    }
  }

  let correctionPlaylist = [];
  let correctionAnswers = {};
  let correctionCurrentQuestionIndex = 0;
  let correctionPlayers = []; // On récupère la liste des joueurs depuis updatePlayers ou autrement
  let correctionCurrentPlayerIndex = 0;

  // Pour enumeration, on stocke un tableau de toggles (6 sous-réponses).
  let enumerationToggles = [];

  const resultsScreen = document.getElementById("resultsScreen");
  const backToLobbyBtn = document.getElementById("backToLobbyBtn");

  backToLobbyBtn.addEventListener("click", () => {
    // On masque l'écran de résultats
    resultsScreen.classList.add("hidden");

    // On réaffiche la salle (ou l'accueil). 
    // Si vous voulez réafficher l'écran de création, par ex.:
    createRoomScreen.classList.remove("hidden");

    // On réinitialise éventuellement l'état local
    gameInProgress = false;
    // On peut remettre iAmHost, gameInProgress, etc. si besoin
  });

  // Démarre la correction
  function startCorrection(playlist, answers) {
    correctionPlaylist = playlist;
    correctionAnswers = answers;
    correctionCurrentQuestionIndex = 0;
    correctionCurrentPlayerIndex = 0;

    // On suppose qu'on a la liste des joueurs => ex: on la stocke dans "players" lors d'updatePlayers
    correctionPlayers = currentPlayers;

    showCorrectionQuestion();
  }

  function showCorrectionQuestion() {

    // Si on a fini toutes les questions :
    if (correctionCurrentQuestionIndex >= correctionPlaylist.length) {
      // Correction terminée
      socket.emit("endCorrection", { roomId: currentRoomId });
      return;
    }

    // On affiche la question
    const questionObj = correctionPlaylist[correctionCurrentQuestionIndex];
    // On efface le contenu
    correctionContent.innerHTML = "";

    // Selon le type enumeration, on fera différemment
    if (questionObj.type === "enumeration") {
      showEnumerationCorrection(questionObj);
    } else {
      showSingleCorrection(questionObj);
    }
  }

  function showSingleCorrection(questionObj) {
    // On récupère le joueur actuel
    if (correctionCurrentPlayerIndex >= correctionPlayers.length) {
      // Tous les joueurs sont corrigés pour cette question => passer à la suivante
      correctionCurrentPlayerIndex = 0;
      correctionCurrentQuestionIndex++;
      showCorrectionQuestion();
      return;
    }
      
    // CENTRER "Question 1 :" ET "Réponse : ..."
    // 1) Afficher le titre "Question X : ..."
    const titleDiv = document.createElement("div");
    titleDiv.textContent = `Question ${correctionCurrentQuestionIndex + 1} : ${questionObj.questionData?.question || ""}`;
    titleDiv.style.textAlign = "center";       // centrage horizontal
    titleDiv.classList.add("questionTitle");
    correctionContent.appendChild(titleDiv);
  
    // 2) Afficher la "Réponse : ..."
    if (questionObj.questionData?.reponse) {
      const officialAnswer = document.createElement("div");
      officialAnswer.textContent = "Réponse : " + questionObj.questionData.reponse;
      officialAnswer.style.fontWeight = "bold";
      officialAnswer.style.textAlign = "center"; // centrage horizontal
      correctionContent.appendChild(officialAnswer);
    }
  
    // 3) Afficher image / audio si besoin
    if (questionObj.type === "image" && questionObj.questionData?.url) {
      const img = document.createElement("img");
      img.src = questionObj.questionData.url;
      img.style.maxHeight = "50vh";
      img.style.display = "block";
      correctionContent.appendChild(img);
    } else if (questionObj.type === "audio" && questionObj.questionData?.url) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = questionObj.questionData.url;
      audio.style.display = "block";
      audio.style.margin = "20px auto"; // centrage
      correctionContent.appendChild(audio);
    } else if (questionObj.type === "texte" && questionObj.questionData?.texte) {
      const texteQuestion = document.createElement("div");
      texteQuestion.textContent = questionObj.questionData.texte;
      texteQuestion.classList.add("texteQuestion");
      correctionContent.appendChild(texteQuestion);
    }
  
    // 4) Joueur + réponse du joueur
    const player = correctionPlayers[correctionCurrentPlayerIndex];
    const playerDiv = document.createElement("div");
    playerDiv.textContent = `${player.pseudo} :`;
    playerDiv.style.textAlign = "center";
    playerDiv.classList.add("playerNameCorrection");
    correctionContent.appendChild(playerDiv);
  
    const playerAnswer = correctionAnswers[correctionCurrentQuestionIndex]?.[player.socketId] || "";
    const answerDiv = document.createElement("div");
    answerDiv.textContent = playerAnswer;
    answerDiv.style.textAlign = "center";
    answerDiv.classList.add("answerCorrection");
    correctionContent.appendChild(answerDiv);
  
    // 5) Bouton toggle VRAI / FAUX
    let correctness = false; // par défaut = FAUX
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "FAUX";
    toggleBtn.style.backgroundColor = "red";
    toggleBtn.style.display = "block";    // Sur une ligne séparée
    toggleBtn.style.margin = "30px auto"; // Centré

    // Ajout de data-attributes pour retrouver le bouton
    toggleBtn.dataset.questionIndex = correctionCurrentQuestionIndex;
    toggleBtn.dataset.playerId = player.socketId; 
    toggleBtn.classList.add("toggle-correctness"); // classe pour un querySelector

    toggleBtn.addEventListener("click", () => {
      if (!iAmHost) return;
      correctness = !correctness;
      socket.emit("toggleCorrectness", {
        roomId: currentRoomId,
        questionIndex: correctionCurrentQuestionIndex,
        playerId: player.socketId,  // si besoin de savoir quel joueur on corrige
        correctness: correctness
      });
    });
    correctionContent.appendChild(toggleBtn);
  
    // 6) Bouton "Suivant" en dessous
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Suivant";
    nextBtn.style.display = "block";
    nextBtn.style.margin = "10px auto";
    nextBtn.disabled = !iAmHost; // Seul l'hôte peut cliquer
    nextBtn.addEventListener("click", () => {
      const points = correctness ? 3 : 0;
      socket.emit("validateAnswer", {
        roomId: currentRoomId,
        questionIndex: correctionCurrentQuestionIndex,
        playerId: player.socketId,
        points
      });
  
      // On passe au joueur suivant
      correctionCurrentPlayerIndex++;

      socket.emit("updateCorrectionState", {
        roomId: currentRoomId,
        questionIndex: correctionCurrentQuestionIndex,
        playerIndex: correctionCurrentPlayerIndex
      });

      showCorrectionQuestion();
    });
    correctionContent.appendChild(nextBtn);
  }
  
function showEnumerationCorrection(questionObj) {
  // Pour un type enumeration, on va corriger 6 sous-questions
  if (correctionCurrentPlayerIndex >= correctionPlayers.length) {
    // Tous les joueurs sont corrigés => question suivante
    correctionCurrentPlayerIndex = 0;
    correctionCurrentQuestionIndex++;
    showCorrectionQuestion();
    return;
  }
  // 1) Afficher le titre "Question X : ..."
  const titleDiv = document.createElement("div");
  titleDiv.textContent = `Question ${correctionCurrentQuestionIndex + 1}`;
  titleDiv.style.textAlign = "center";
  titleDiv.classList.add("enumerationTitle");
  correctionContent.appendChild(titleDiv);


  // Afficher la lettre
  const letterDiv = document.createElement("div");
  letterDiv.textContent = `${questionObj.letter}`;
  letterDiv.style.textAlign = "center";
  letterDiv.classList.add("enumerationLetter");
  correctionContent.appendChild(letterDiv);

  // Afficher le nom du joueur
  const player = correctionPlayers[correctionCurrentPlayerIndex];
  const playerDiv = document.createElement("div");
  playerDiv.textContent = `${player.pseudo} :`;
  playerDiv.style.textAlign = "center";
  playerDiv.classList.add("playerNameCorrection");
  correctionContent.appendChild(playerDiv);

  // Récupérer la réponse du joueur
  const playerAnswer = correctionAnswers[correctionCurrentQuestionIndex]?.[player.socketId] || [];
  // c'est un tableau de 6 réponses (selon votre collectUserAnswer pour enumeration)

  const container = document.createElement("div");
  container.classList.add("enumerationContainer");
  correctionContent.appendChild(container);

  // On crée 6 lignes
  const subQuestions = questionObj.questions; // 6 sous-questions

  subQuestions.forEach((subQ, i) => {
    // 1) Label "Sous question i"
    const subQDiv = document.createElement("div");
    subQDiv.classList.add("subQuestion");
    subQDiv.textContent = subQ.question;
    container.appendChild(subQDiv);


    // 2) On crée une ligne horizontale pour la "box" + le bouton
    const row = document.createElement("div");
    row.classList.add("enumerationRow");
    // On peut faire row.style.display = "flex"; row.style.alignItems = "center";
    // pour aligner sur la même ligne

    // 2a) La box contenant la réponse
    const answerBox = document.createElement("div");
    answerBox.classList.add("enumerationAnswerBox"); 
    // On met la réponse dedans
    answerBox.textContent = (playerAnswer[i] || "");
    row.appendChild(answerBox);

    // 2b) Le bouton VRAI/FAUX à droite
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "FAUX";
    toggleBtn.style.backgroundColor = "red";
    // data-attributes pour subIndex
    toggleBtn.dataset.questionIndex = correctionCurrentQuestionIndex;
    toggleBtn.dataset.playerId = player.socketId;
    toggleBtn.dataset.subIndex = i;
    toggleBtn.classList.add("toggle-correctness");

    toggleBtn.addEventListener("click", () => {
      if (!iAmHost) return;
      const newValue = (toggleBtn.textContent === "FAUX"); // si c'est FAUX on passe à VRAI
      socket.emit("toggleCorrectness", {
        roomId: currentRoomId,
        questionIndex: correctionCurrentQuestionIndex,
        playerId: player.socketId,
        subIndex: i,
        correctness: newValue
      });
    });

    row.appendChild(toggleBtn);

    // On ajoute la ligne au contenu
    container.appendChild(row);
  });


  // Bouton suivant
  const nextBtn = document.createElement("button");
  nextBtn.textContent = "Suivant";
  nextBtn.disabled = !iAmHost;
  nextBtn.addEventListener("click", () => {
    // On calcule le nombre de VRAI => c’est le nombre de points
    let points = 0;
    for (let i = 0; i < 6; i++) {
      const btn = document.querySelector(`.toggle-correctness[data-question-index="${correctionCurrentQuestionIndex}"][data-player-id="${player.socketId}"][data-sub-index="${i}"]`);
      if (btn && btn.textContent === "VRAI") {
        points++;
      }
    }
    // On envoie au serveur
    socket.emit("validateAnswer", {
      roomId: currentRoomId,
      questionIndex: correctionCurrentQuestionIndex,
      playerId: player.socketId,
      points
    });

    // Joueur suivant
    correctionCurrentPlayerIndex++;

    socket.emit("updateCorrectionState", {
      roomId: currentRoomId,
      questionIndex: correctionCurrentQuestionIndex,
      playerIndex: correctionCurrentPlayerIndex
    });
  
    showCorrectionQuestion();
  });
  container.appendChild(nextBtn);
}

  /**
   * Montre/masque les éléments d'UI réservés à l'hôte.
   */
  function toggleUIForHost(isHost) {
    if (isHost) {
      startGameBtn.style.display = "inline-block";
      toggleThemesBtn.style.display = "inline-block";
      nbQuestionsInput.disabled = false;
      themesList.querySelectorAll("input[type='checkbox']").forEach(cb => {
        cb.disabled = false;
      });
    } else {
      startGameBtn.style.display = "none";
      toggleThemesBtn.style.display = "none";
      nbQuestionsInput.disabled = true;
      themesList.querySelectorAll("input[type='checkbox']").forEach(cb => {
        cb.disabled = true;
      });
    }
  }
});
