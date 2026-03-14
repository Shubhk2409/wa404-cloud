const socket = io();

// Tabs Logic
function showTab(id) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById('tab-' + id).style.display = 'block';
}

// Global UI Updater
function updateStatus(status) {
    const span = document.getElementById('conn-status');
    span.textContent = status;
    span.className = 'status-badge ' + (status === 'Connected' ? 'connected' : (status === 'QR Code Ready' ? 'warning' : 'disconnected'));
    
    document.getElementById('qr-box').style.display = status === 'QR Code Ready' ? 'block' : 'none';
    document.getElementById('logout-btn').style.display = status === 'Connected' ? 'inline-block' : 'none';
}

// Socket Events
socket.on('status', (status) => {
    updateStatus(status);
});

let qrRenderer = null;
socket.on('qr', (qrCode) => {
    updateStatus('QR Code Ready');
    const container = document.getElementById('qrcode-render');
    container.innerHTML = '';
    qrRenderer = new QRCode(container, {
        text: qrCode,
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
});

socket.on('log', (msg) => {
    const logDiv = document.getElementById('log-console');
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${msg}`;
    logDiv.appendChild(line);
    logDiv.scrollTop = logDiv.scrollHeight;
});

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => {
        alert('Logged out. Waiting for new QR...');
    });
});

// Bulk Shoot
document.getElementById('bulk-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData();
    const csvFile = document.getElementById('csv-file').files[0];
    const mediaFile = document.getElementById('media-file').files[0];
    const manualNums = document.getElementById('manual-nums').value;
    const msgBody = document.getElementById('msg-body').value;

    if (!csvFile && !manualNums) {
        return alert('Please upload a CSV or enter manual numbers.');
    }

    if (csvFile) formData.append('csv', csvFile);
    if (mediaFile) formData.append('media', mediaFile);
    formData.append('manualNumbers', manualNums);
    formData.append('messageBody', msgBody);

    fetch('/api/bulk', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.error) alert(data.error);
        });
});

// Extractor
document.getElementById('extract-btn').addEventListener('click', () => {
    const statusDiv = document.getElementById('extractor-status');
    statusDiv.innerHTML = '<span class="text-warning">Extracting... This may take a few minutes depending on chats...</span>';
    
    fetch('/api/extract')
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                statusDiv.innerHTML = `<span class="text-danger">${data.error}</span>`;
            } else {
                statusDiv.innerHTML = `<span class="text-success">Extracted ${data.count} contacts! Generating CSV...</span>`;
                let csvContent = "data:text/csv;charset=utf-8,Name,Phone,Source\n";
                data.contacts.forEach(c => {
                    csvContent += `"${c.name}","${c.phone}","${c.source}"\n`;
                });
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", `extracted_contacts.csv`);
                document.body.appendChild(link);
                link.click();
                link.remove();
            }
        });
});
