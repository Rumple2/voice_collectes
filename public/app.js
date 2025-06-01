let mediaRecorder;
let audioChunks = [];
let currentPhrase = null;
let userEmail = '';
let translationsCount = 0;

async function startRecording() {
    const email = document.getElementById('email').value;
    if (!email || !email.includes('@')) {
        alert('Veuillez entrer une adresse email valide');
        return;
    }

    userEmail = email;
    document.getElementById('user-email').textContent = email;
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('recording-section').classList.remove('hidden');
    
    await loadNextPhrase();
}

async function loadNextPhrase() {
    try {
        const response = await fetch('/phrases/next');
        const data = await response.json();
        
        if (!data || !data.id) {
            alert('Plus de phrases disponibles pour le moment !');
            return;
        }

        currentPhrase = data;
        document.getElementById('current-phrase').textContent = data.text;
        document.getElementById('record-button').disabled = false;
    } catch (error) {
        console.error('Erreur lors du chargement de la phrase:', error);
        alert('Erreur lors du chargement de la phrase');
    }
}

async function toggleRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        // Démarrer l'enregistrement
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                const audioUrl = URL.createObjectURL(audioBlob);
                const audioPlayer = document.getElementById('audio-player');
                audioPlayer.src = audioUrl;
                document.getElementById('audio-preview').classList.remove('hidden');
            };

            mediaRecorder.start();
            document.getElementById('record-button').style.backgroundColor = '#c0392b';
            document.getElementById('recording-status').classList.remove('hidden');
        } catch (error) {
            console.error('Erreur lors de l\'accès au microphone:', error);
            alert('Erreur lors de l\'accès au microphone');
        }
    } else {
        // Arrêter l'enregistrement
        mediaRecorder.stop();
        document.getElementById('record-button').style.backgroundColor = '#e74c3c';
        document.getElementById('recording-status').classList.add('hidden');
    }
}

async function submitRecording() {
    if (!currentPhrase || !audioChunks.length) return;

    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    formData.append('phrase_id', currentPhrase.id);
    formData.append('user_id', userEmail);

    try {
        const response = await fetch('/audios', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            translationsCount++;
            document.getElementById('translations-count').textContent = translationsCount;
            document.getElementById('audio-preview').classList.add('hidden');
            await loadNextPhrase();
        } else {
            throw new Error('Erreur lors de l\'envoi de l\'enregistrement');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur lors de l\'envoi de l\'enregistrement');
    }
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    document.getElementById('audio-preview').classList.add('hidden');
    document.getElementById('record-button').style.backgroundColor = '#e74c3c';
    document.getElementById('recording-status').classList.add('hidden');
    audioChunks = [];
} 