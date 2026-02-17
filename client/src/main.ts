import './style.css';
import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000' 
    : window.location.origin);

interface User {
  id: number;
  username: string;
  avatar_data?: string | null;
  friend_code?: string;
}

interface Room {
  id: number;
  name: string;
  room_code: string;
  created_by: number;
  creator_name?: string;
  member_count?: number;
}

interface Message {
  id: number;
  room_id?: number;
  sender_id?: number;
  receiver_id?: number;
  user_id: number;
  username: string;
  message: string | null;
  drawing_data: string | null;
  message_type: 'text' | 'drawing' | 'both';
  created_at: string;
  avatar_data?: string | null;
}

interface Friend {
  id: number;
  username: string;
  avatar_data: string | null;
  status: 'pending' | 'accepted';
}

interface Channel {
  id: number;
  room_id: number;
  name: string;
  type: 'text' | 'voice';
}

class PictoChatApp {
  private socket: Socket | null = null;
  private token: string | null = null;
  private user: User | null = null;
  private currentRoom: Room | null = null;
  private currentFriend: Friend | null = null;
  private currentChannel: Channel | null = null;
  private lastTextChannel: Channel | null = null;
  private activeVoiceChannel: Channel | null = null;
  private voiceParticipantsMap: Map<number, {id: number, username: string}[]> = new Map(); // channelId -> participants
  private rooms: Room[] = [];
  private friends: Friend[] = [];
  private channels: Channel[] = [];
  private roomMembers: User[] = [];
  private messages: Message[] = [];
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;
  private currentColor = '#000000';
  private brushSize = 3;
  private showDrawingMode = false;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private darkMode = false;
  private localStream: MediaStream | null = null;
  private peerConnections: Map<number, RTCPeerConnection> = new Map();
  private isMuted = false;
  private deferredPrompt: any = null;

  constructor() {
    this.init();
    this.setupPWA();
  }

  private setupPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      this.deferredPrompt = e;
      // Update UI notify the user they can install the PWA
      this.renderInstallButton();
    });

    window.addEventListener('appinstalled', () => {
      // Clear the deferredPrompt so it can be garbage collected
      this.deferredPrompt = null;
      console.log('PWA was installed');
      this.renderInstallButton();
    });
  }

  private renderInstallButton() {
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) {
      // Always show the button, but its functionality depends on deferredPrompt
      installBtn.style.display = 'block'; 
      if (!this.deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
        // Optional: Can make the button inactive or show a message if not installable
        installBtn.classList.add('disabled'); // Example: add a disabled class
        installBtn.title = "L'application est déjà installée ou votre navigateur ne supporte pas l'installation directe.";
      } else {
        installBtn.classList.remove('disabled');
        installBtn.title = "Installer l'application";
      }

      installBtn.onclick = () => {
        if (this.deferredPrompt) {
          this.deferredPrompt.prompt();
          this.deferredPrompt.userChoice.then((choice: any) => {
            if (choice.outcome === 'accepted') {
              console.log('User accepted the install prompt');
              installBtn.style.display = 'none'; // Hide button after successful install
            }
            this.deferredPrompt = null;
            this.renderInstallButton(); // Re-render to update state
          });
        } else if (!window.matchMedia('(display-mode: standalone)').matches) {
          alert("L'application est déjà installée ou votre navigateur ne supporte pas l'installation directe. Utilisez le menu de votre navigateur ('Ajouter à l'écran d'accueil').");
        }
      };
    }
  }

  private async installPWA() {
    if (!this.deferredPrompt) return;
    
    // Show the install prompt
    this.deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    this.deferredPrompt = null;
    this.renderInstallButton();
  }

  private init() {
    // Check for saved theme preference (default to dark)
    const savedTheme = localStorage.getItem('theme');
    this.darkMode = savedTheme === null ? true : savedTheme === 'dark';
    if (this.darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }

    // Check for saved token
    this.token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (userStr) {
      this.user = JSON.parse(userStr);
    }

    if (this.token && this.user) {
      this.connectSocket();
      this.showMainApp();
    } else {
      this.showAuth();
    }
  }

  private toggleTheme() {
    this.darkMode = !this.darkMode;
    if (this.darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }

  private connectSocket() {
    this.socket = io(API_URL);
    
    this.socket.on('connect', () => {
      console.log('Connected to server');
      if (this.token) {
        this.socket!.emit('authenticate', this.token);
      }
    });

    this.socket.on('new_message', (message: Message) => {
      this.messages.push(message);
      this.renderMessages();
      this.scrollToBottom();
    });

    this.socket.on('new_direct_message', (message: Message) => {
      if (this.currentFriend && (message.sender_id === this.currentFriend.id || message.receiver_id === this.currentFriend.id)) {
        this.messages.push(message);
        this.renderMessages();
        this.scrollToBottom();
      } else {
        // Notify user about new DM
        console.log('New DM from:', message.username);
        this.loadFriends(); // Refresh to show unread or something
      }
    });

    this.socket.on('user_updated', (data: { id: number, avatar_data: string }) => {
      // Update any matching user in memories
      if (this.user && this.user.id === data.id) {
        this.user.avatar_data = data.avatar_data;
        localStorage.setItem('user', JSON.stringify(this.user));
      }
      
      // Update in friends list
      const friend = this.friends.find(f => f.id === data.id);
      if (friend) friend.avatar_data = data.avatar_data;
      
      // Update in room members
      const member = this.roomMembers.find(m => m.id === data.id);
      if (member) member.avatar_data = data.avatar_data;

      // Update in messages currently displayed
      this.messages.forEach(msg => {
        if (msg.user_id === data.id) msg.avatar_data = data.avatar_data;
      });

      this.showMainApp();
    });

    this.socket.on('user_joined', (data: { username: string }) => {
      this.addSystemMessage(`${data.username} joined`);
    });

    this.socket.on('user_left', (data: { username: string }) => {
      this.addSystemMessage(`${data.username} left`);
    });

    this.socket.on('voice_users_update', (data: { channelId: number, participants: {id: number, username: string}[] }) => {
      this.voiceParticipantsMap.set(data.channelId, data.participants);
      this.refreshChannelSidebar();
    });

    this.socket.on('incoming_call', async (data: { userId: number, username: string, callId: string }) => {
      if (confirm(`${data.username} vous appelle. Répondre ?`)) {
        this.socket!.emit('accept_call', { callId: data.callId, targetUserId: data.userId });
        this.joinPrivateCall(data.callId, data.userId);
      }
    });

    this.socket.on('call_accepted', (data: { userId: number, callId: string }) => {
      this.createPeerConnection(data.userId, true);
    });

    this.socket.on('user_joined_voice', async (data: { userId: number, username: string }) => {
      if (this.localStream) {
        await this.createPeerConnection(data.userId, true);
      }
    });

    this.socket.on('user_left_voice', (data: { userId: number }) => {
      this.closePeerConnection(data.userId);
    });

    this.socket.on('voice_signal', async (data: { userId: number, signal: any }) => {
      if (!this.peerConnections.has(data.userId)) {
        await this.createPeerConnection(data.userId, false);
      }
      const pc = this.peerConnections.get(data.userId);
      if (pc) {
        if (data.signal.sdp) {
          const desc = new RTCSessionDescription(data.signal.sdp);
          if (desc.type === 'offer') {
            await pc.setRemoteDescription(desc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.socket!.emit('voice_signal', { targetUserId: data.userId, signal: { sdp: pc.localDescription } });
          } else if (desc.type === 'answer') {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(desc);
            }
          }
        } else if (data.signal.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
          } catch (e) { console.error('Error adding ICE candidate', e); }
        }
      }
    });
  }

  private addSystemMessage(text: string) {
    const messagesArea = document.querySelector('.messages-area');
    if (!messagesArea) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'system-message';
    messageEl.textContent = text;
    messagesArea.appendChild(messageEl);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    const messagesArea = document.querySelector('.messages-area');
    if (messagesArea) {
      // Immediate scroll
      messagesArea.scrollTop = messagesArea.scrollHeight;
      // Delayed scroll for images/rendering settle
      setTimeout(() => {
        messagesArea.scrollTop = messagesArea.scrollHeight;
      }, 50);
      requestAnimationFrame(() => {
        messagesArea.scrollTop = messagesArea.scrollHeight;
      });
    }
  }

  // ============================================
  // AUTH SCREEN
  // ============================================

  private showAuth() {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="auth-container">
        <div class="auth-box">
          <div class="auth-title">PICTOCHATTER</div>
          <div class="auth-tabs">
            <button class="tab-button active" data-tab="login">CONNEXION</button>
            <button class="tab-button" data-tab="register">INSCRIPTION</button>
          </div>
          <form class="auth-form" id="auth-form">
            <input type="text" class="input-field" id="username" placeholder="NOM D'UTILISATEUR" required>
            <input type="password" class="input-field" id="password" placeholder="MOT DE PASSE" required>
            <button type="submit" class="btn-primary">CONNEXION</button>
            <div class="error-message" id="error-message"></div>
          </form>
        </div>
      </div>
    `;

    let currentTab = 'login';
    const tabs = document.querySelectorAll('.tab-button');
    const form = document.getElementById('auth-form') as HTMLFormElement;
    const submitBtn = form.querySelector('.btn-primary')!;

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.getAttribute('data-tab')!;
        submitBtn.textContent = currentTab === 'login' ? 'CONNEXION' : 'INSCRIPTION';
        document.getElementById('error-message')!.textContent = '';
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = (document.getElementById('username') as HTMLInputElement).value;
      const password = (document.getElementById('password') as HTMLInputElement).value;
      
      try {
        const endpoint = currentTab === 'login' ? '/api/auth/login' : '/api/auth/register';
        const response = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Authentication failed');
        }

        this.token = data.token;
        this.user = data.user;
        localStorage.setItem('token', this.token!);
        localStorage.setItem('user', JSON.stringify(this.user!));
        
        this.connectSocket();
        this.showMainApp();
      } catch (error: any) {
        document.getElementById('error-message')!.textContent = error.message;
      }
    });
  }

  // ============================================
  // MAIN APP - DISCORD LAYOUT
  // ============================================

  private async showMainApp(forceFetch = false) {
    // Optimization: Use cached data if available to avoid click-to-render latency
    if (forceFetch || (this.rooms.length === 0 && this.token)) {
      await this.loadRooms();
    }
    if (forceFetch || (this.friends.length === 0 && this.token)) {
      await this.loadFriends();
    }

    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="app-container">
        <div class="left-panel">
          <div class="sidebars-container">
            ${this.renderServerSidebar()}
            ${this.renderChannelSidebar()}
          </div>
          ${this.renderUserArea()}
        </div>
        ${this.renderMainContent()}
      </div>
    `;

    this.setupMainAppListeners();
    this.scrollToBottom();
  }

  private async loadFriends() {
    if (!this.token) return;
    try {
      const response = await fetch(`${API_URL}/api/friends`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (response.status === 401) return this.handleUnauthorized();
      const data = await response.json();
      this.friends = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching friends:', error);
      this.friends = [];
    }
  }

  private handleUnauthorized() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.token = null;
    this.user = null;
    this.showAuth();
  }

  private renderServerSidebar(): string {
    return `
      <div class="server-sidebar">
        <div class="server-icon home active" title="HOME">
          H
        </div>
        <div class="server-separator"></div>
        ${(this.rooms || []).slice(0, 10).map(room => `
          <div class="server-icon" data-room-id="${room.id}" title="${room.name}">
            ${room.name.charAt(0).toUpperCase()}
          </div>
        `).join('')}
        <button class="add-server-btn" id="add-server-btn" title="ADD SERVER">+</button>
      </div>
    `;
  }

  private renderMainContent(): string {
    if (!this.currentRoom && !this.currentFriend) {
      return `
        <div class="main-content">
          <div class="empty-state">
            <div class="home-box">
              <div class="empty-state-text">BIENVENUE SUR PICTOCHATTER</div>
              <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: var(--space-md);">REJOIGNEZ UN SERVEUR OU UN AMI POUR COMMENCER</div>
              <button class="btn-primary" id="install-app-btn" style="padding: 12px 24px; font-size: 12px; margin-top: 10px;">INSTALLER L'APPLICATION</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.currentChannel?.type === 'voice') {
      return `
        <div class="main-content">
          <div class="chat-header">
            <span class="channel-hash">🔊</span>
            <span>${this.currentChannel.name.toUpperCase()}</span>
          </div>
          <div class="voice-container" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; background: rgba(0,0,0,0.1);">
            <div class="voice-avatar-pulse">
              <div class="user-avatar-large" style="${this.user?.avatar_data ? `background-image: url(${this.user.avatar_data})` : ''}">
                ${!this.user?.avatar_data ? this.user?.username.charAt(0).toUpperCase() : ''}
              </div>
            </div>
            <div class="voice-status" style="margin-top: 24px; text-align: center;">
              <div style="font-size: 14px; font-weight: bold;">SALON VOCAL CONNECTE</div>
              <div style="font-size: 10px; color: var(--accent-green); margin-top: 4px;">VOUS ETES EN LIGNE</div>
            </div>
            <div style="display: flex; gap: 16px; margin-top: 32px;">
              <button class="btn-secondary" id="mute-btn" style="width: 44px; height: 44px; border-radius: 50%; padding: 0; font-size: 20px;">
                ${this.isMuted ? '🔇' : '🎙️'}
              </button>
              <button class="btn-secondary" id="leave-voice-btn" style="background: var(--accent-red); color: white; border-color: var(--accent-red); width: 44px; height: 44px; border-radius: 50%; padding: 0; font-size: 20px;">
                📞
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const headerTitle = this.currentChannel ? this.currentChannel.name : (this.currentRoom ? this.currentRoom.name : this.currentFriend!.username);
    const headerInfo = this.currentRoom ? `CODE : ${this.currentRoom.room_code}` : 'MESSAGE PRIVE';

    return `
      <div class="main-content">
        <div class="chat-header" style="display: flex; align-items: center; gap: 8px;">
          <span class="channel-hash">${this.currentChannel ? '#' : (this.currentRoom ? '#' : '@')}</span>
          <span style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${headerTitle.toUpperCase()}</span>
          ${this.currentFriend ? `<button id="call-friend-btn" class="btn-secondary" style="padding: 4px 8px; font-size: 14px; margin-right: 8px;">📞 APPELER</button>` : ''}
          <span style="font-size: 7px; color: var(--text-muted);">${headerInfo}</span>
        </div>
        <div class="messages-area" id="messages-area">
          ${this.renderMessagesHTML()}
        </div>
        ${this.renderMessageInput()}
        ${this.activeVoiceChannel && this.currentChannel?.id !== this.activeVoiceChannel.id ? this.renderVoiceOverlay() : ''}
      </div>
      ${this.currentRoom ? `
        <div class="right-panel">
          <div class="member-list">
            <div class="member-category">MEMBRES — ${this.roomMembers.length}</div>
            ${this.roomMembers.map(member => `
              <div class="member-item">
                <div class="member-avatar" style="${member.avatar_data ? `background-image: url(${member.avatar_data})` : ''}">
                  ${!member.avatar_data ? member.username.charAt(0).toUpperCase() : ''}
                </div>
                <div class="member-name">${member.username.toUpperCase()}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  }

  private renderVoiceOverlay(): string {
    return `
      <div class="voice-overlay">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="pulse-icon"></span>
          <span style="font-size: 10px;">EN VOCAL : ${this.activeVoiceChannel?.name.toUpperCase()}</span>
        </div>
        <button class="btn-secondary" id="overlay-leave-voice" style="background: var(--accent-red); color: white; border: none; padding: 4px 8px; font-size: 10px; border-radius: 4px;">RACCROCHER</button>
      </div>
    `;
  }

  private renderChannelSidebar(): string {
    const roomName = this.currentRoom ? this.currentRoom.name : 'PICTOCHATTER';
    const isOwner = this.currentRoom && this.currentRoom.created_by === this.user?.id;
    
    return `
      <div class="channel-sidebar">
        <div class="server-header" style="position: relative;">
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${roomName.toUpperCase()}</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            ${isOwner ? `
              <button class="icon-btn-small" id="delete-server-trigger" title="SUPPRIMER SERVEUR" style="color: var(--accent-red); padding: 2px 4px; font-size: 10px;">🗑️</button>
            ` : ''}
            <button class="theme-toggle" id="theme-toggle" title="CHANGER THEME">
              ${this.darkMode ? '☀' : '🌙'}
            </button>
          </div>
        </div>
        <div class="channel-list">
          ${this.currentRoom ? `
            <div class="channel-category">SALONS</div>
            ${(this.channels || []).map((channel, index) => {
              const participants = this.voiceParticipantsMap.get(channel.id) || [];
              return `
                <div class="channel-item ${this.currentChannel?.id === channel.id ? 'active' : ''}" data-channel-id="${channel.id}" style="display: flex; align-items: center;">
                  <span class="channel-icon">${channel.type === 'text' ? '#' : '🔊'}</span>
                  <span style="flex: 1;">${channel.name.toUpperCase()}</span>
                  ${isOwner ? `
                    <div class="channel-actions" style="display: flex; gap: 2px; opacity: 0.5;">
                      <button class="action-btn delete-channel" data-id="${channel.id}" title="SUPPRIMER">×</button>
                      <button class="action-btn move-up" data-id="${channel.id}" data-index="${index}" title="MONTER">↑</button>
                      <button class="action-btn move-down" data-id="${channel.id}" data-index="${index}" title="DESCENDRE">↓</button>
                    </div>
                  ` : ''}
                </div>
                ${participants.length > 0 ? `
                  <div class="voice-participants" style="padding-left: 24px;">
                    ${participants.map(p => `
                      <div class="voice-user" style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted); padding: 2px 0;">
                        <span style="width: 4px; height: 4px; background: var(--accent-green); border-radius: 50%;"></span>
                        <span>${p.username}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              `;
            }).join('')}
            ${isOwner ? `
              <div class="channel-item" id="add-channel-btn" style="color: var(--text-muted); font-size: 10px; margin-top: 8px;">
                <span class="channel-icon">+</span>
                <span>NOUVEAU SALON</span>
              </div>
            ` : ''}
          ` : `
            <div class="channel-category">AMIS</div>
            <div class="channel-item" id="add-friend-btn-trigger">
              <span class="channel-icon">+</span>
              <span>AJOUTER UN AMI</span>
            </div>
            ${(this.friends || []).map(friend => `
              <div class="channel-item friend-item ${this.currentFriend?.id === friend.id ? 'active' : ''}" data-friend-id="${friend.id}">
                <div class="friend-avatar" style="${friend.avatar_data ? `background-image: url(${friend.avatar_data})` : ''}">
                  ${!friend.avatar_data ? friend.username.charAt(0).toUpperCase() : ''}
                </div>
                <span>${friend.username.toUpperCase()}</span>
                ${friend.status === 'pending' ? '<span style="font-size: 8px;">(ATTENTE)</span>' : ''}
              </div>
            `).join('')}
          `}
        </div>
      </div>
    `;
  }

  private renderUserArea(): string {
    return `
      <div class="user-area-full">
        <div class="user-box" id="user-profile-trigger">
          <div class="user-avatar-small" style="${this.user?.avatar_data ? `background-image: url(${this.user.avatar_data})` : ''}">
            ${!this.user?.avatar_data ? this.user?.username.charAt(0).toUpperCase() : ''}
          </div>
          <div class="user-info">${this.user!.username.toUpperCase()}</div>
          <button class="logout-btn" id="logout-btn">DÉCONNECTER</button>
        </div>
      </div>
    `;
  }

  private renderMessagesHTML(): string {
    if (this.messages.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-text">AUCUN MESSAGE</div>
          <div class="empty-state-text">LANCEZ LA CONVERSATION</div>
        </div>
      `;
    }

    let html = '';
    let lastUserId: number | null = null;

    this.messages.forEach(msg => {
      // Use user_id for group checking
      const currentMsgUserId = msg.user_id;
      const showAvatar = currentMsgUserId !== lastUserId;
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      const avatarHtml = msg.avatar_data 
        ? `<div class="message-avatar" style="background-image: url(${msg.avatar_data}); background-size: cover; background-position: center;"></div>`
        : `<div class="message-avatar">${msg.username.charAt(0).toUpperCase()}</div>`;

      if (showAvatar) {
        html += `
          <div class="message-group">
            ${avatarHtml}
            <div class="message-content">
              <div class="message-header">
                <span class="message-username">${msg.username.toUpperCase()}</span>
                <span class="message-time">${time}</span>
              </div>
              ${msg.message ? `<div class="message-text">${this.escapeHtml(msg.message)}</div>` : ''}
              ${msg.drawing_data ? `
                <div class="message-drawing">
                  <img src="${msg.drawing_data}" alt="DRAWING">
                </div>
              ` : ''}
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="message-group" style="padding-top: 0; padding-bottom: 0;">
            <div class="message-avatar" style="visibility: hidden; height: 0; width: 40px;"></div>
            <div class="message-content">
              ${msg.message ? `<div class="message-text">${this.escapeHtml(msg.message)}</div>` : ''}
              ${msg.drawing_data ? `
                <div class="message-drawing">
                  <img src="${msg.drawing_data}" alt="DRAWING">
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }
      lastUserId = currentMsgUserId;
    });

    return html;
  }

  private renderMessageInput(): string {
    const canvasBg = this.darkMode ? '#000000' : '#ffffff';
    return `
      <div class="message-input-area" data-canvas-bg="${canvasBg}">
        ${this.showDrawingMode ? this.renderDrawingPanel() : ''}
        <div class="input-wrapper">
          <textarea class="message-input" id="message-input" placeholder="TAPEZ UN MESSAGE..." rows="1"></textarea>
          <button class="btn-icon ${this.showDrawingMode ? 'active' : ''}" id="toggle-draw-btn" title="DESSINER">✏</button>
          <button class="btn-icon" id="send-btn" title="ENVOYER">→</button>
        </div>
      </div>
    `;
  }

  private renderDrawingPanel(): string {
    const canvasBg = this.darkMode ? '#000000' : '#ffffff';
    return `
      <div class="drawing-panel" data-canvas-bg="${canvasBg}">
        <div class="canvas-wrapper">
          <canvas id="drawing-canvas" width="256" height="128"></canvas>
        </div>
        <div class="drawing-tools">
          <button class="tool-button active" id="pen-tool" title="STYLO">
            <img src="/img/pencil.png" alt="STYLO" width="20">
          </button>
          <button class="tool-button" id="eraser-tool" title="GOMME">
            <img src="/img/eraser.png" alt="GOMME" width="20">
          </button>
          <button class="tool-button" id="clear-tool" title="EFFACER">
            <img src="/img/cross.png" alt="EFFACER" width="20">
          </button>
          <div class="color-picker">
            <button class="color-button active" style="background: #000000;" data-color="#000000"></button>
            <button class="color-button" style="background: #ffffff;" data-color="#ffffff"></button>
            <button class="color-button" style="background: #ff0000;" data-color="#ff0000"></button>
            <button class="color-button" style="background: #0000ff;" data-color="#0000ff"></button>
            <button class="color-button" style="background: #00ff00;" data-color="#00ff00"></button>
            <button class="color-button" style="background: #ffff00;" data-color="#ffff00"></button>
            <button class="color-button" style="background: #ff00ff;" data-color="#ff00ff"></button>
          </div>
          <div class="brush-size-control">
            <span class="brush-size-label">TAILLE</span>
            <input type="range" class="brush-size-slider" id="brush-size" min="1" max="10" value="3">
          </div>
        </div>
      </div>
    `;
  }

  private setupMainAppListeners() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        this.toggleTheme();
        this.showMainApp(); // Refresh to update icon
      });
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent opening profile modal
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.token = null;
        this.user = null;
        this.rooms = [];
        this.friends = [];
        this.currentRoom = null;
        this.currentFriend = null;
        this.currentChannel = null;
        if (this.socket) {
          this.socket.disconnect();
        }
        this.showAuth();
      });
    }

    // Install App button
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) {
      this.renderInstallButton();
      installBtn.addEventListener('click', () => this.installPWA());
    }

    // Server icons
    document.querySelectorAll('.server-icon:not(.home)').forEach(icon => {
      icon.addEventListener('click', () => {
        const roomId = parseInt(icon.getAttribute('data-room-id')!);
        const room = this.rooms.find(r => r.id === roomId);
        if (room) {
          this.joinRoom(room);
        }
      });
    });

    // Friend items
    document.querySelectorAll('.friend-item').forEach(item => {
      item.addEventListener('click', () => {
        const friendId = parseInt(item.getAttribute('data-friend-id')!);
        const friend = this.friends.find(f => f.id === friendId);
        if (friend) {
          this.joinFriend(friend);
        }
      });
    });

    // Channel items
    document.querySelectorAll('.channel-item[data-channel-id]').forEach(item => {
      item.addEventListener('click', () => {
        const channelId = parseInt(item.getAttribute('data-channel-id')!);
        const channel = this.channels.find(c => c.id === channelId);
        if (channel) {
          this.joinChannel(channel);
        }
      });
    });

    // Add channel button
    const addChannelBtn = document.getElementById('add-channel-btn');
    if (addChannelBtn) {
      addChannelBtn.addEventListener('click', () => this.showCreateChannelModal());
    }

    // Home button
    const homeIcon = document.querySelector('.server-icon.home');
    if (homeIcon) {
      homeIcon.addEventListener('click', () => {
        if (this.currentRoom && this.socket) this.socket.emit('leave_room', this.currentRoom.id);
        if (this.currentChannel && this.socket) this.socket.emit('leave_channel', this.currentChannel.id);
        this.currentRoom = null;
        this.currentFriend = null;
        this.currentChannel = null;
        this.messages = [];
        this.showMainApp();
      });
    }

    // Profile Trigger
    const profileTrigger = document.getElementById('user-profile-trigger');
    if (profileTrigger) {
      profileTrigger.addEventListener('click', () => this.showProfileModal());
    }

    const addFriendBtn = document.getElementById('add-friend-btn-trigger');
    if (addFriendBtn) {
      addFriendBtn.addEventListener('click', () => this.showAddFriendModal());
    }

    // Add server button
    const addServerBtn = document.getElementById('add-server-btn');
    if (addServerBtn) {
      addServerBtn.addEventListener('click', () => this.showServerChoiceModal());
    }

    const deleteServerTrigger = document.getElementById('delete-server-trigger');
    if (deleteServerTrigger) {
      deleteServerTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Voulez-vous vraiment supprimer ce serveur ? Cette action est irréversible.')) {
          this.deleteServer();
        }
      });
    }

    // Channel action listeners
    document.querySelectorAll('.delete-channel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt((btn as HTMLElement).dataset.id!);
        if (confirm('Supprimer ce salon ?')) {
          this.deleteChannel(id);
        }
      });
    });

    document.querySelectorAll('.move-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt((btn as HTMLElement).dataset.index!);
        this.moveChannel(index, -1);
      });
    });

    document.querySelectorAll('.move-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt((btn as HTMLElement).dataset.index!);
        this.moveChannel(index, 1);
      });
    });

    // Voice controls
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => this.toggleMute());
    }

    const leaveVoiceBtn = document.getElementById('leave-voice-btn');
    if (leaveVoiceBtn) {
      leaveVoiceBtn.addEventListener('click', () => {
        this.leaveVoice();
      });
    }

    const overlayLeaveBtn = document.getElementById('overlay-leave-voice');
    if (overlayLeaveBtn) {
      overlayLeaveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.leaveVoice();
      });
    }

    const callFriendBtn = document.getElementById('call-friend-btn');
    if (callFriendBtn && this.currentFriend) {
      callFriendBtn.addEventListener('click', async () => {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.activeVoiceChannel = { id: 0, name: 'APPEL PRIVE', room_id: 0, type: 'voice' };
          this.socket!.emit('start_private_call', { targetUserId: this.currentFriend!.id });
          this.addSystemMessage(`Appel en cours vers ${this.currentFriend!.username}...`);
          this.showMainApp();
        } catch (error) {
          console.error('Mic access error:', error);
          alert('Impossible d\'accéder au micro.');
        }
      });
    }

    // Chat input listeners
    if (this.currentChannel || this.currentFriend) {
      this.setupChatListeners();
    }
  }

  private setupChatListeners() {
    const toggleDrawBtn = document.getElementById('toggle-draw-btn');
    const sendBtn = document.getElementById('send-btn');
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;

    if (toggleDrawBtn) {
      toggleDrawBtn.addEventListener('click', () => {
        this.showDrawingMode = !this.showDrawingMode;
        this.toggleDrawingModeUI();
      });
    }

    if (messageInput) {
      messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }

    if (this.showDrawingMode) {
      this.setupCanvas();
    }
  }

  private toggleDrawingModeUI() {
    const messageArea = document.getElementById('messages-area');
    const scrollPos = messageArea ? messageArea.scrollTop : 0;
    
    // Partially refresh only the input area to preserve chat scroll
    const inputArea = document.querySelector('.message-input-area');
    if (inputArea) {
      const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
      const currentText = messageInput ? messageInput.value : '';
      
      inputArea.outerHTML = this.renderMessageInput();
      
      this.setupChatListeners();
      
      const newMessageInput = document.getElementById('message-input') as HTMLTextAreaElement;
      if (newMessageInput) {
        newMessageInput.value = currentText;
        newMessageInput.focus();
      }
    }

    // Restore scroll just in case
    if (messageArea) {
      messageArea.scrollTop = scrollPos;
    }
  }

  private setupCanvas() {
    this.canvas = document.getElementById('drawing-canvas') as HTMLCanvasElement;
    if (!this.canvas) return;
    
    this.ctx = this.canvas.getContext('2d')!;

    // Setup drawing
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseout', () => this.stopDrawing());

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas!.dispatchEvent(mouseEvent);
    });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas!.dispatchEvent(mouseEvent);
    });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.stopDrawing();
    });

    // Color picker
    document.querySelectorAll('.color-button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentColor = btn.getAttribute('data-color')!;
      });
    });

    // Brush size
    const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
    if (brushSizeSlider) {
      brushSizeSlider.addEventListener('input', () => {
        this.brushSize = parseInt(brushSizeSlider.value);
      });
    }

    // Tools
    const penTool = document.getElementById('pen-tool');
    if (penTool) {
      penTool.addEventListener('click', () => {
        document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
        penTool.classList.add('active');
        this.currentColor = document.querySelector('.color-button.active')?.getAttribute('data-color') || '#000000';
      });
    }

    const eraserTool = document.getElementById('eraser-tool');
    if (eraserTool) {
      eraserTool.addEventListener('click', () => {
        document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
        eraserTool.classList.add('active');
        const canvasBg = this.darkMode ? '#000000' : '#ffffff';
        this.currentColor = canvasBg;
      });
    }

    const clearTool = document.getElementById('clear-tool');
    if (clearTool) {
      clearTool.addEventListener('click', () => {
        if (this.ctx && this.canvas) {
          const canvasBg = this.darkMode ? '#000000' : '#ffffff';
          this.ctx.fillStyle = canvasBg;
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
      });
    }

    // Initialize canvas with theme-aware background
    if (this.ctx && this.canvas) {
      const canvasBg = this.darkMode ? '#000000' : '#ffffff';
      this.ctx.fillStyle = canvasBg;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private startDrawing(e: MouseEvent) {
    this.isDrawing = true;
    const rect = this.canvas!.getBoundingClientRect();
    const scaleX = this.canvas!.width / rect.width;
    const scaleY = this.canvas!.height / rect.height;
    this.lastX = (e.clientX - rect.left) * scaleX;
    this.lastY = (e.clientY - rect.top) * scaleY;
  }

  private draw(e: MouseEvent) {
    if (!this.isDrawing || !this.ctx || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();

    this.lastX = x;
    this.lastY = y;
  }

  private stopDrawing() {
    this.isDrawing = false;
  }

  private async sendMessage() {
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
    if (!messageInput) return;
    
    const text = messageInput.value.trim();
    let drawingData = null;

    if (this.showDrawingMode && this.canvas) {
      // Use WebP with compression for optimization
      drawingData = this.canvas.toDataURL('image/webp', 0.5);
    }

    if (!text && !drawingData) return;

    const messageType = text && drawingData ? 'both' : drawingData ? 'drawing' : 'text';

    if (this.socket && (this.currentChannel || this.currentFriend)) {
      this.socket.emit('send_message', {
        roomId: this.currentRoom?.id,
        channelId: this.currentChannel?.id,
        friendId: this.currentFriend?.id,
        message: text || null,
        drawingData,
        messageType
      });

      messageInput.value = '';
      // NOTE: We don't clear the canvas automatically as per user request
    }
  }

  private showProfileModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">MON PROFIL</div>
        <div class="profile-modal-content">
          <div class="profile-avatar-large" id="avatar-edit" style="${this.user?.avatar_data ? `background-image: url(${this.user.avatar_data})` : ''}">
            ${!this.user?.avatar_data ? this.user?.username.charAt(0).toUpperCase() : ''}
          </div>
          <div class="user-info" style="font-size: 16px;">${this.user?.username.toUpperCase()}</div>
          <div class="friend-code-display" style="font-size: 10px; color: var(--text-muted); margin-top: -8px;">#${this.user?.friend_code}</div>
          
          <input type="file" id="avatar-input" style="display: none;" accept="image/*">
          
          <div style="display: flex; flex-direction: column; gap: var(--space-sm); width: 100%; margin-top: var(--space-md);">
            <button class="btn-primary" id="close-profile">FERMER</button>
            <button class="btn-secondary" id="delete-profile" style="color: var(--accent-red); border-color: var(--accent-red); margin-top: var(--space-lg);">SUPPRIMER LE PROFIL</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const avatarEdit = modal.querySelector('#avatar-edit')!;
    const avatarInput = modal.querySelector('#avatar-input') as HTMLInputElement;

    avatarEdit.addEventListener('click', () => avatarInput.click());

    avatarInput.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          // Compress avatar to 256x256 WebP
          const compressedBase64 = await this.compressImage(file, 256, 256);
          
          const response = await fetch(`${API_URL}/api/users/profile`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify({ avatar_data: compressedBase64 })
          });
          if (response.ok) {
            this.user!.avatar_data = compressedBase64;
            localStorage.setItem('user', JSON.stringify(this.user));
            modal.remove();
            this.showMainApp();
          }
        } catch (error) {
          console.error('Error updating avatar:', error);
        }
      }
    });

    modal.querySelector('#close-profile')!.addEventListener('click', () => modal.remove());
    
    modal.querySelector('#delete-profile')!.addEventListener('click', async () => {
      if (confirm('ÊTES-VOUS SÛR DE VOULOIR SUPPRIMER VOTRE PROFIL ? CETTE ACTION EST IRRÉVERSIBLE ET SUPPRIMERA TOUS VOS MESSAGES ET AMIS.')) {
        try {
          const response = await fetch(`${API_URL}/api/users/profile`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.token}`
            }
          });
          if (response.ok) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            location.reload();
          }
        } catch (error) {
          console.error('Error deleting profile:', error);
        }
      }
    });
  }

  private showAddFriendModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">AJOUTER UN AMI</div>
        <form class="modal-form" id="add-friend-form">
          <input type="text" class="input-field" id="friend-identifier" placeholder="PSEUDO OU CODE (#123456)" required>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="cancel-btn">ANNULER</button>
            <button type="submit" class="btn-primary">AJOUTER</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#cancel-btn')!.addEventListener('click', () => modal.remove());
    (modal.querySelector('#add-friend-form') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      let identifier = (modal.querySelector('#friend-identifier') as HTMLInputElement).value;
      // Remove # if present for friend code
      identifier = identifier.replace('#', '').trim();
      
      try {
        const response = await fetch(`${API_URL}/api/friends/add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ identifier })
        });
        
        if (response.ok) {
          modal.remove();
          this.loadFriends().then(() => this.showMainApp());
        } else {
          const err = await response.json();
          alert(err.error || 'UTILISATEUR INTROUVABLE');
        }
      } catch (err) { 
        console.error(err);
        alert('ERREUR LORS DE L\'AJOUT');
      }
    });
  }

  private async joinFriend(friend: Friend) {
    if (friend.status === 'pending') {
      if (confirm(`Accepter la demande d'ami de ${friend.username}?`)) {
        await fetch(`${API_URL}/api/friends/accept`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ friendId: friend.id })
        });
        await this.loadFriends();
      }
      return;
    }

    this.currentRoom = null;
    this.currentFriend = friend;
    
    // Show UI immediately with empty/cached messages for responsiveness
    this.showMainApp();
    
    // Fetch DMs in background
    try {
      const response = await fetch(`${API_URL}/api/direct-messages/${friend.id}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      const data = await response.json();
      this.messages = Array.isArray(data) ? data : [];
      this.renderMessages();
    } catch (error) {
      console.error('Error fetching DMs:', error);
      this.messages = [];
    }
  }

  private renderMessages() {
    const messagesArea = document.getElementById('messages-area');
    if (messagesArea) {
      messagesArea.innerHTML = this.renderMessagesHTML();
      this.scrollToBottom();
    }
  }

  private async compressImage(file: File, maxWidth: number, maxHeight: number): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/webp', 0.6));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  // ============================================
  // ROOM MANAGEMENT
  // ============================================

  private showServerChoiceModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">CHOISIR UNE ACTION</div>
        <div class="modal-form">
          <button class="btn-primary" id="create-server-choice" style="margin-bottom: 12px; width: 100%;">CREER UN SERVEUR</button>
          <button class="btn-primary" id="join-server-choice" style="width: 100%;">REJOINDRE UN SERVEUR</button>
          <button class="btn-secondary" id="cancel-choice" style="margin-top: 12px; width: 100%;">ANNULER</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#create-server-choice')!.addEventListener('click', () => {
      modal.remove();
      this.showCreateRoomModal();
    });

    modal.querySelector('#join-server-choice')!.addEventListener('click', () => {
      modal.remove();
      this.showJoinRoomModal();
    });

    modal.querySelector('#cancel-choice')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  private async loadRooms() {
    if (!this.token) return;
    try {
      const response = await fetch(`${API_URL}/api/rooms`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      if (response.status === 401) return this.handleUnauthorized();
      const data = await response.json();
      this.rooms = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching rooms:', error);
      this.rooms = [];
    }
  }

  private async loadChannels(roomId: number) {
    try {
      const response = await fetch(`${API_URL}/api/rooms/${roomId}/channels`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      if (response.status === 401) return this.handleUnauthorized();
      const data = await response.json();
      this.channels = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching channels:', error);
      this.channels = [];
    }
  }

  private async loadMembers(roomId: number) {
    if (!this.token) return;
    try {
      const response = await fetch(`${API_URL}/api/rooms/${roomId}/members`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (response.status === 401) return this.handleUnauthorized();
      const data = await response.json();
      this.roomMembers = Array.isArray(data) ? data : [];
      this.showMainApp();
    } catch (error) {
      console.error('Error fetching members:', error);
      this.roomMembers = [];
    }
  }

  private async joinRoom(room: Room) {
    this.currentRoom = room;
    this.currentFriend = null;
    this.roomMembers = [];

    // Join socket room immediately
    if (this.socket) {
      this.socket.emit('join_room', room.id);
    }

    // Load channels and members
    await Promise.all([
      this.loadChannels(room.id),
      this.loadMembers(room.id)
    ]);
    
    // Auto-join first text channel
    const textChannel = this.channels.find(c => c.type === 'text');
    if (textChannel) {
      this.joinChannel(textChannel);
    } else {
      this.showMainApp();
    }
  }

  private async joinChannel(channel: Channel) {
    if (this.currentChannel && this.socket) {
      this.socket.emit('leave_channel', this.currentChannel.id);
    }

    if (channel.type === 'text') {
      this.lastTextChannel = channel;
    }

    this.currentChannel = channel;
    this.messages = []; // Clear current messages

    if (channel.type === 'text') {
      if (this.socket) {
        this.socket.emit('join_channel', channel.id);
      }
      
      this.showMainApp();
      
      try {
        const response = await fetch(`${API_URL}/api/channels/${channel.id}/messages`, {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        });
        const data = await response.json();
        this.messages = Array.isArray(data) ? data : [];
        this.renderMessages();
      } catch (error) {
        console.error('Error fetching messages:', error);
        this.messages = [];
      }
    } else {
      // Voice channel logic
      if (this.activeVoiceChannel?.id !== channel.id) {
        this.joinVoice(channel);
      } else {
        this.showMainApp();
      }
    }
  }

  private async joinVoice(channel: Channel) {
    if (this.activeVoiceChannel) {
      this.leaveVoice();
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.activeVoiceChannel = channel;
      if (this.socket) {
        this.socket.emit('join_voice', channel.id);
      }
      this.showMainApp();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Impossible d\'accéder au micro. Vérifiez les permissions.');
    }
  }

  private leaveVoice() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.socket && this.activeVoiceChannel) {
      this.socket.emit('leave_voice', this.activeVoiceChannel.id);
    }

    this.activeVoiceChannel = null;
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    
    // Switch back to last text channel if possible
    if (this.lastTextChannel) {
      this.joinChannel(this.lastTextChannel);
    } else {
      this.showMainApp();
    }
  }

  private async joinPrivateCall(callId: string, targetUserId: number) {
    try {
      console.log(`Joining private call ${callId} with ${targetUserId}`);
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.activeVoiceChannel = { id: 0, name: 'APPEL PRIVE', room_id: 0, type: 'voice' }; // Pseudo channel for call
      this.showMainApp();
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  }

  private refreshChannelSidebar() {
    const sidebar = document.querySelector('.channel-sidebar');
    if (sidebar) {
      sidebar.outerHTML = this.renderChannelSidebar();
      this.setupMainAppListeners();
    }
  }

  private toggleMute() {
    if (this.localStream) {
      this.isMuted = !this.isMuted;
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
      this.showMainApp();
    }
  }

  private async createPeerConnection(userId: number, isOffer: boolean) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.peerConnections.set(userId, pc);

    this.localStream?.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream!);
    });

    pc.ontrack = (event) => {
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket!.emit('voice_signal', { targetUserId: userId, signal: { candidate: event.candidate } });
      }
    };

    if (isOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket!.emit('voice_signal', { targetUserId: userId, signal: { sdp: pc.localDescription } });
    }

    return pc;
  }

  private closePeerConnection(userId: number) {
    const pc = this.peerConnections.get(userId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(userId);
    }
  }

  private showCreateChannelModal() {
    if (!this.currentRoom) return;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">CREER UN SALON</div>
        <form class="modal-form" id="create-channel-form">
          <input type="text" class="input-field" id="channel-name" placeholder="NOM DU SALON" required>
          <select class="input-field" id="channel-type" style="background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 8px; border-radius: 4px; margin-bottom: 12px; width: 100%;">
            <option value="text">SALON TEXTUEL</option>
            <option value="voice">SALON VOCAL</option>
          </select>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="cancel-btn">ANNULER</button>
            <button type="submit" class="btn-primary">CREER</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#cancel-btn')!.addEventListener('click', () => modal.remove());
    
    (modal.querySelector('#create-channel-form') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (modal.querySelector('#channel-name') as HTMLInputElement).value;
      const type = (modal.querySelector('#channel-type') as HTMLSelectElement).value as 'text' | 'voice';
      
      try {
        const response = await fetch(`${API_URL}/api/rooms/${this.currentRoom!.id}/channels`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ name, type })
        });

        if (response.ok) {
          const channel = await response.json();
          modal.remove();
          await this.loadChannels(this.currentRoom!.id);
          this.joinChannel(channel);
        }
      } catch (error) {
        console.error('Error creating channel:', error);
      }
    });
  }

  private showCreateRoomModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">CRÉER UN SERVEUR</div>
        <form class="modal-form" id="create-room-form">
          <input type="text" class="input-field" id="room-name" placeholder="NOM DU SERVEUR" required>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="cancel-btn">ANNULER</button>
            <button type="submit" class="btn-primary">CRÉER</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#cancel-btn')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    (modal.querySelector('#create-room-form') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (modal.querySelector('#room-name') as HTMLInputElement).value;
      
      try {
        const response = await fetch(`${API_URL}/api/rooms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ name })
        });

        const room = await response.json();
        modal.remove();
        await this.loadRooms();
        this.joinRoom(room);
      } catch (error) {
        console.error('Error creating room:', error);
      }
    });
  }

  private showJoinRoomModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-title">REJOINDRE UN SERVEUR</div>
        <form class="modal-form" id="join-room-form">
          <input type="text" class="input-field" id="room-code" placeholder="ENTREZ LE CODE" required maxlength="6">
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="cancel-btn">ANNULER</button>
            <button type="submit" class="btn-primary">REJOINDRE</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#cancel-btn')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    (modal.querySelector('#join-room-form') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      const roomCode = (modal.querySelector('#room-code') as HTMLInputElement).value.toUpperCase();
      
      try {
        const response = await fetch(`${API_URL}/api/rooms/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ roomCode })
        });

        if (!response.ok) {
          throw new Error('Salon introuvable');
        }

        const room = await response.json();
        modal.remove();
        await this.loadRooms();
        this.joinRoom(room);
      } catch (error: any) {
        alert(error.message);
      }
    });
  }

  private async deleteServer() {
    if (!this.currentRoom || !this.token) return;
    try {
      const response = await fetch(`${API_URL}/api/rooms/${this.currentRoom.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (response.ok) {
        this.currentRoom = null;
        this.currentChannel = null;
        this.channels = [];
        this.messages = [];
        await this.loadRooms();
        this.showMainApp();
      }
    } catch (error) {
      console.error('Error deleting server:', error);
    }
  }

  private async deleteChannel(channelId: number) {
    if (!this.token) return;
    try {
      const response = await fetch(`${API_URL}/api/channels/${channelId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (response.ok) {
        if (this.currentChannel?.id === channelId) {
          this.currentChannel = null;
          this.messages = [];
        }
        if (this.currentRoom) {
          await this.loadChannels(this.currentRoom.id);
        }
        this.showMainApp();
      }
    } catch (error) {
      console.error('Error deleting channel:', error);
    }
  }

  private async moveChannel(index: number, direction: number) {
    if (!this.currentRoom || !this.token) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.channels.length) return;

    // Swap locally
    const temp = this.channels[index];
    this.channels[index] = this.channels[newIndex];
    this.channels[newIndex] = temp;

    const channelIds = this.channels.map(c => c.id);
    
    try {
      await fetch(`${API_URL}/api/rooms/${this.currentRoom.id}/channels/reorder`, {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ channelIds })
      });
      this.showMainApp();
    } catch (error) {
      console.error('Error reordering channels:', error);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app
new PictoChatApp();
