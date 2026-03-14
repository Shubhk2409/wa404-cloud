document.addEventListener('DOMContentLoaded', () => {
    // Socket.io initialization
    const socket = io();

    socket.on('connect', () => {
        console.log('Connected to server via Socket.io');
    });

    // Navigation logic (SPA style view toggling)
    const navItems = document.querySelectorAll('.nav-item');
    const pageHeader = document.getElementById('page-header');
    const pageViews = document.querySelectorAll('.page-view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = e.target.getAttribute('data-page');

            // Update Navigation state
            navItems.forEach(nav => nav.classList.remove('active'));
            e.target.classList.add('active');
            pageHeader.textContent = e.target.textContent;

            // Update Views state
            pageViews.forEach(view => {
                if (view.id === `view-${targetPage}`) {
                    view.style.display = 'block';
                } else {
                    view.style.display = 'none';
                }
            });

            // Trigger specific page load actions
            if (targetPage === 'dashboard') loadDashboardStats();
            if (targetPage === 'accounts') loadAccounts();
            if (targetPage === 'inbox') loadInbox();
            if (targetPage === 'templates') { loadTemplates(); loadAutoReplies(); }
        });
    });

    // --- DASHBOARD LOGIC ---
    let mainChartInstance = null;
    function loadDashboardStats() {
        fetch('/api/stats')
            .then(res => res.json())
            .then(data => {
                document.getElementById('stat-total').textContent = data.total_sent || 0;
                document.getElementById('stat-delivered').textContent = data.delivered || 0;
                document.getElementById('stat-failed').textContent = data.failed || 0;
                document.getElementById('stat-active').textContent = data.active_accounts || 0;
                
                // Initialize Dummy Chart if not already
                if (!mainChartInstance) {
                    const ctx = document.getElementById('mainChart');
                    if(ctx) {
                        mainChartInstance = new Chart(ctx, {
                            type: 'line',
                            data: {
                                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                                datasets: [{
                                    label: 'Messages Sent',
                                    data: [10, 45, 12, 70, 90, 20, 110],
                                    borderColor: '#00d2ff',
                                    backgroundColor: 'rgba(0, 210, 255, 0.1)',
                                    borderWidth: 2, fill: true, tension: 0.4
                                }]
                            },
                            options: {
                                responsive: true, maintainAspectRatio: false,
                                plugins: { legend: { labels: { color: '#f0f0f0' } } },
                                scales: {
                                    x: { ticks: { color: '#8b92a5' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                                    y: { ticks: { color: '#8b92a5' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                                }
                            }
                        });
                    }
                }
            })
            .catch(err => console.error(err));
    }

    // --- ACCOUNTS LOGIC ---
    const accountsContainer = document.getElementById('accounts-container');
    const qrModal = document.getElementById('qr-modal');
    const qrcodeContainer = document.getElementById('qrcode-container');
    let qrWidget = null;
    let currentConnectingId = null;

    function loadAccounts() {
        fetch('/api/accounts')
            .then(res => res.json())
            .then(data => {
                if(data.accounts.length === 0) {
                    accountsContainer.innerHTML = '<p>No accounts connected. Add new account.</p>';
                    return;
                }
                
                let html = '';
                data.accounts.forEach(acc => {
                    html += `
                        <div class="account-card glass-panel" style="position: relative;">
                            <h4>Account #${acc.id}</h4>
                            <p>Number: <span class="highlight">${acc.phone_number || 'Waiting Connect...'}</span></p>
                            <p>Status: <span class="status-badge ${acc.status.toLowerCase()}">${acc.status}</span></p>
                            <button class="btn btn-danger btn-sm mt-3" onclick="deleteAccount(${acc.id})">Remove</button>
                        </div>
                    `;
                });
                accountsContainer.innerHTML = html;
            })
            .catch(err => console.error(err));
    }

    document.getElementById('add-account-btn').addEventListener('click', () => {
        fetch('/api/accounts', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if(data.success) {
                    currentConnectingId = data.accountId;
                    document.getElementById('qr-modal').style.display = 'flex';
                    qrcodeContainer.innerHTML = '<p>Generating QR Code... Please wait</p>';
                    loadAccounts(); // Refresh background list
                }
            });
    });

    document.getElementById('close-qr-btn').addEventListener('click', () => {
        qrModal.style.display = 'none';
        if(qrWidget) { qrWidget.clear(); qrWidget = null; }
    });

    socket.on('qr_code', (data) => {
        if(data.accountId === currentConnectingId) {
            qrcodeContainer.innerHTML = ''; // clear loading text
            
            // Generate QR Code with distinct styling to pop out on Dark Mode
            qrWidget = new QRCode(qrcodeContainer, {
                text: data.qr,
                width: 250,
                height: 250,
                colorDark : "#0a0c10", // Dark matched brand
                colorLight : "#ffffff", // Pure white for scanner
                correctLevel : QRCode.CorrectLevel.H
            });
            
            // Add slight rounded styling to the Canvas container
            const qrCanvas = qrcodeContainer.querySelector('canvas');
            if (qrCanvas) {
                qrCanvas.style.borderRadius = "8px";
                qrCanvas.style.padding = "10px";
                qrCanvas.style.background = "#fff";
                qrCanvas.style.boxShadow = "0 8px 30px rgba(0,0,0,0.5)";
            }
        }
    });

    socket.on('auth_status', (data) => {
        if(data.accountId === currentConnectingId && data.status === 'Authenticated') {
            qrModal.style.display = 'none'; // Close modal automatically
            if(qrWidget) { qrWidget.clear(); qrWidget = null; }
            alert('WhatsApp Authenticated Successfully!');
            loadAccounts();
        } else {
            loadAccounts(); // refresh if status changed for other accounts
        }
    });

    socket.on('client_ready', (data) => {
        loadAccounts();
    });

    // Expose global delete function for inline onclick
    window.deleteAccount = function(id) {
        if(confirm('Are you sure you want to remove this WhatsApp account?')) {
            fetch(`/api/accounts/${id}`, { method: 'DELETE' })
                .then(res => Object.keys(res.json()))
                .then(data => loadAccounts());
        }
    };

    // Initial load
    loadDashboardStats();

    // --- CAMPAIGN FORM LOGIC ---
    document.getElementById('campaign-form').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('name', document.getElementById('camp-name').value);
        formData.append('messageBody', document.getElementById('camp-message').value);
        
        const manual = document.getElementById('camp-manual').value;
        if (manual) formData.append('manualNumbers', manual);
        
        const schedule = document.getElementById('camp-schedule').value;
        if (schedule) formData.append('scheduleTime', new Date(schedule).toISOString().replace('T', ' ').substring(0, 19));

        const csvFile = document.getElementById('camp-csv').files[0];
        if (csvFile) formData.append('csv', csvFile);

        const mediaFile = document.getElementById('camp-media').files[0];
        if (mediaFile) formData.append('media', mediaFile);
        
        const templateSelect = document.getElementById('camp-template-select');
        if (templateSelect && templateSelect.value) {
            formData.append('templateId', templateSelect.value);
        }

        fetch('/api/campaigns', {
            method: 'POST',
            body: formData // Note: no Content-Type header needed for FormData
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Campaign Created! ${data.messagesCount} messages queued.`);
                document.getElementById('campaign-form').reset();
            } else {
                alert(`Error: ${data.error}`);
            }
        })
        .catch(err => console.error(err));
    });

    // --- INBOX LOGIC ---
    function loadInbox() {
        const inboxContainer = document.getElementById('inbox-messages');
        fetch('/api/inbox')
            .then(res => res.json())
            .then(data => {
                inboxContainer.innerHTML = '';
                if(data.messages.length === 0) {
                    inboxContainer.innerHTML = '<p>No messages received yet.</p>';
                    return;
                }
                data.messages.forEach(msg => {
                    const div = document.createElement('div');
                    div.style.padding = '1rem';
                    div.style.background = 'rgba(255,255,255,0.05)';
                    div.style.borderRadius = '8px';
                    div.style.borderLeft = '4px solid var(--accent)';
                    div.innerHTML = `
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                            From: ${msg.from_number} | To Account: ${msg.phone_number} | ${new Date(msg.received_at).toLocaleString()}
                        </div>
                        <div style="font-size: 1rem;">${msg.message_body}</div>
                    `;
                    inboxContainer.appendChild(div);
                });
            });
    }

    socket.on('new_message', () => {
        if(document.getElementById('view-inbox').style.display === 'block') {
            loadInbox();
        }
    });

    // --- EXTRACTOR LOGIC ---
    const btnExtract = document.getElementById('btn-extract');
    if (btnExtract) {
        btnExtract.addEventListener('click', () => {
            const accId = document.getElementById('ext-account-id').value;
            if(!accId) return alert('Enter an Account ID');
            
            const statusDiv = document.getElementById('extractor-status');
            statusDiv.innerHTML = '<span class="text-warning">Extracting... Please wait.</span>';
            
            fetch(`/api/extractor/${accId}`)
                .then(res => res.json())
                .then(data => {
                    if(data.error) {
                        statusDiv.innerHTML = `<span class="text-danger">Error: ${data.error}</span>`;
                    } else {
                        statusDiv.innerHTML = `<span class="text-success">Extracted ${data.count} contacts! Generating CSV...</span>`;
                        let csvContent = "data:text/csv;charset=utf-8,Name,Phone,Source\n";
                        data.contacts.forEach(c => {
                            csvContent += `"${c.name}","${c.phone}","${c.source}"\n`;
                        });
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", `contacts_acc_${accId}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                    }
                })
                .catch(err => statusDiv.innerHTML = `<span class="text-danger">Failed to extract</span>`);
        });
    }

    // Load templates/replies structure helpers
    let savedTemplatesData = [];
    window.loadTemplates = function() {
        const templatesList = document.getElementById('templates-list');
        const campTemplateSelect = document.getElementById('camp-template-select');
        
        fetch('/api/templates')
            .then(res => res.json())
            .then(data => {
                savedTemplatesData = data.templates;
                templatesList.innerHTML = '';
                
                if(campTemplateSelect) {
                    campTemplateSelect.innerHTML = '<option value="">-- Write Custom Message Below --</option>';
                }

                if(data.templates.length === 0) {
                    templatesList.innerHTML = '<p class="text-muted">No templates found.</p>';
                } else {
                    data.templates.forEach(tpl => {
                        // Populate list in Template View
                        const div = document.createElement('div');
                        div.style.padding = '1rem';
                        div.style.background = 'rgba(255,255,255,0.05)';
                        div.style.borderRadius = '8px';
                        div.style.marginBottom = '1rem';
                        
                        let mediaSpan = '';
                        if (tpl.media_path) {
                            mediaSpan = `<span class="status-badge connected" style="font-size: 0.7rem; margin-left: 10px;">📎 Media Attached</span>`;
                        }
                        
                        div.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <strong>${tpl.name}</strong> ${mediaSpan}
                                <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${tpl.id})">Delete</button>
                            </div>
                            <div style="font-size: 0.9rem; color: var(--text-muted); white-space: pre-wrap;">${tpl.body}</div>
                        `;
                        templatesList.appendChild(div);

                        // Populate Dropdown in Campaigns View
                        if (campTemplateSelect) {
                            const option = document.createElement('option');
                            option.value = tpl.id;
                            option.textContent = tpl.name + (tpl.media_path ? ' 📎' : '');
                            campTemplateSelect.appendChild(option);
                        }
                    });
                }
            });
    };

    // Campaign Template Selection Event
    const campTemplateSelect = document.getElementById('camp-template-select');
    if (campTemplateSelect) {
        campTemplateSelect.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            const messageBox = document.getElementById('camp-message');
            if (!selectedId) {
                messageBox.value = '';
                return;
            }
            const tpl = savedTemplatesData.find(t => t.id == selectedId);
            if (tpl) {
                messageBox.value = tpl.body;
                if (tpl.media_path) {
                    alert('Note: This template has attached media. You still need to select a file manually above if you want to override it, otherwise the backend will try to link the original soon. For now, manual upload is safest.');
                }
            }
        });
    }

    window.deleteTemplate = function(id) {
        if(confirm('Delete template?')) {
            fetch(`/api/templates/${id}`, { method: 'DELETE' }).then(() => loadTemplates());
        }
    };

    document.getElementById('template-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('name', document.getElementById('tpl-name').value);
        formData.append('body', document.getElementById('tpl-body').value);
        
        const mediaFile = document.getElementById('tpl-media').files[0];
        if (mediaFile) formData.append('media', mediaFile);

        fetch('/api/templates', { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                if(data.success) {
                    document.getElementById('template-form').reset();
                    loadTemplates();
                    alert('Template saved!');
                } else {
                    alert('Error: ' + data.error);
                }
            });
    });

    window.loadAutoReplies = function() {
        const arList = document.getElementById('autoreplies-list');
        fetch('/api/autoreplies')
            .then(res => res.json())
            .then(data => {
                arList.innerHTML = '';
                if(data.replies.length === 0) {
                    arList.innerHTML = '<p class="text-muted">No auto replies active.</p>';
                    return;
                }
                data.replies.forEach(ar => {
                    const div = document.createElement('div');
                    div.style.padding = '1rem';
                    div.style.borderLeft = '4px solid var(--accent-secondary)';
                    div.style.background = 'rgba(255,255,255,0.05)';
                    div.style.borderRadius = '8px';
                    div.style.marginBottom = '1rem';
                    div.innerHTML = `
                        <div style="margin-bottom: 0.5rem;"><strong>Keyword:</strong> ${ar.keyword}</div>
                        <div style="font-size: 0.9rem; color: var(--text-muted); white-space: pre-wrap;"><strong>Reply:</strong> ${ar.reply_body}</div>
                    `;
                    arList.appendChild(div);
                });
            });
    };

    document.getElementById('autoreply-form').addEventListener('submit', (e) => {
        e.preventDefault();
        fetch('/api/autoreplies', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                keyword: document.getElementById('ar-keyword').value,
                replyBody: document.getElementById('ar-body').value
            })
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                document.getElementById('autoreply-form').reset();
                loadAutoReplies();
            } else {
                alert('Error: ' + data.error);
            }
        });
    });
});
