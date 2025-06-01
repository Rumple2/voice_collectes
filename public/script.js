let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let startTime;
let timerInterval;
let currentPhrase = null;
let recordCount = 0;

// Éléments DOM
const recordButton = document.getElementById('recordButton');
const timerDisplay = document.getElementById('timer');
const phraseText = document.getElementById('phraseText');
const recordCountDisplay = document.getElementById('recordCount');
const loadingOverlay = document.getElementById('loadingOverlay');

// Fonction pour afficher/masquer le loading
function toggleLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
}

// Fonction pour formater le temps
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Fonction pour mettre à jour le timer
function updateTimer() {
    const elapsed = Date.now() - startTime;
    timerDisplay.textContent = formatTime(elapsed);
}

// Fonction pour démarrer l'enregistrement
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await submitRecording(audioBlob);
        };
        
        mediaRecorder.start();
        isRecording = true;
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        recordButton.classList.add('recording');
        recordButton.innerHTML = '<i class="fas fa-stop"></i>';
    } catch (error) {
        console.error('Erreur lors de l\'accès au microphone:', error);
        alert('Erreur lors de l\'accès au microphone. Veuillez vérifier les permissions.');
    }
}

// Fonction pour arrêter l'enregistrement
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        clearInterval(timerInterval);
        recordButton.classList.remove('recording');
        recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
    }
}

// Fonction pour soumettre l'enregistrement
async function submitRecording(audioBlob) {
    try {
        toggleLoading(true);
        
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('phrase_id', currentPhrase.id);
        formData.append('user_id', localStorage.getItem('userEmail') || 'anonymous');

        const response = await fetch('/audios', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Erreur lors de l\'envoi de l\'enregistrement');
        }

        const result = await response.json();
        if (result.success) {
            recordCount++;
            recordCountDisplay.textContent = recordCount;
            await loadNextPhrase();
        }
    } catch (error) {
        console.error('Erreur lors de la soumission:', error);
        alert('Erreur lors de l\'envoi de l\'enregistrement. Veuillez réessayer.');
    } finally {
        toggleLoading(false);
    }
}

// Fonction pour charger la phrase suivante
async function loadNextPhrase() {
    try {
        const response = await fetch('/phrases/next');
        if (!response.ok) {
            throw new Error('Erreur lors du chargement de la phrase');
        }
        currentPhrase = await response.json();
        phraseText.textContent = currentPhrase.text || 'Plus de phrases disponibles';
    } catch (error) {
        console.error('Erreur lors du chargement de la phrase:', error);
        phraseText.textContent = 'Erreur lors du chargement de la phrase';
    }
}

// Gestionnaire d'événements pour le bouton d'enregistrement
recordButton.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

// Charger la première phrase au démarrage
loadNextPhrase(); 