# 🎮 PictoChatter - Plateforme Sociale Inspirée de la Nintendo DS

Une plateforme de chat moderne inspirée du PictoChatter de la Nintendo DS, avec un design Discord, une interface en français, et le système de design rétro de la Nintendo DS. Fonctionnalités de chat en temps réel, dessin, et gestion de salons.

![PictoChatter](https://img.shields.io/badge/Status-Ready-green)
![Node](https://img.shields.io/badge/Node-18+-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)

## ✨ Fonctionnalités

### 🎨 Design Rétro Nintendo DS
- **Police bitmap** - Fonte Press Start 2P authentique
- **Bordures dures** - 0px border-radius, look pixel-perfect
- **Couleurs plates** - Pas de dégradés, design rétro pur
- **Mode sombre par défaut** - Avec basculement vers mode clair
- **Canvas adaptatif** - Arrière-plan noir (mode sombre) ou blanc (mode clair)
- **Rendu pixel-perfect** - Image rendering pixelated

### 💬 Architecture Discord
- **Barre latérale serveurs** - Icônes de salons avec navigation rapide
- **Liste de salons** - Navigation par salons avec icône #
- **Messages groupés** - Avatars avec lettres, groupement par utilisateur
- **Interface plein écran** - Utilise tout l'espace disponible
- **Messages privés (DMs)** - Conversations privées avec gestion des amis et appels en direct

### 🇫🇷 Interface Française
- **100% en français** - Toute l'interface traduite
- **Terminologie claire** - Salons, Messages, Créer, Rejoindre, etc.
- **Messages d'erreur** - En français
- **Tooltips** - Descriptions en français

### 🎨 Fonctionnalités PictoChatter
- **Canvas de dessin** - Dessinez comme sur le PictoChatter original
- **Outils de dessin** - Stylo, gomme, effacer, 6 couleurs, taille de pinceau
- **Messages mixtes** - Texte + dessin dans le même message
- **Codes de salon** - Codes à 6 caractères pour partager

### 🚀 Fonctionnalités Modernes
- **Authentification** - Système de connexion/inscription sécurisé
- **Salons multiples** - Créez et rejoignez des salons illimités
- **Chat vocal** - Salons vocaux persistants avec WebRTC (signaling Socket.io)
- **Appels privés** - Appelez vos amis directement depuis la section DM
- **Navigation rapide** - Cliquez sur les icônes de serveur pour changer de salon
- **Responsive** - Fonctionne sur desktop, tablette et mobile
- **Sécurité et conformité** - Protection XSS, CSP, HPP, et jetons JWT expirables (7j)

## 🛠️ Stack Technique

### Frontend
- **Vite** - Outil de build rapide et serveur de développement
- **TypeScript** - JavaScript typé pour plus de sécurité
- **Socket.io Client** - Communication WebSocket temps réel
- **CSS Vanilla** - Design rétro Nintendo DS personnalisé

### Backend
- **Node.js + Express** - Framework serveur
- **Socket.io** - Communication bidirectionnelle temps réel
- **SQLite (better-sqlite3)** - Base de données embarquée légère
- **JWT** - Authentification sécurisée
- **bcryptjs** - Hashage de mots de passe

## 📋 Prérequis

- Node.js (v18 ou supérieur)
- npm ou yarn
- Un navigateur web moderne

## 🚀 Installation et Développement Local

### 1. Installer les Dépendances

Installez d'abord les dépendances racine :

```bash
npm install
```

Puis les dépendances du client :

```bash
cd client
npm install
cd ..
```

### 2. Configurer les Variables d'Environnement

Le projet vient avec des fichiers `.env` par défaut, mais changez le secret JWT pour la production :

**Racine `.env` :**
```env
PORT=3000
CLIENT_URL=http://localhost:5173
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

**Client `.env` :**
```env
VITE_API_URL=http://localhost:3000
```

### 3. Lancer l'Application

Lancez le serveur et le client simultanément :

```bash
npm run dev
```

Ou lancez-les séparément :

**Terminal 1 - Serveur :**
```bash
npm run server
```

**Terminal 2 - Client :**
```bash
npm run client
```

L'application sera disponible sur :
- **Frontend** : http://localhost:5173
- **Backend API** : http://localhost:3000

## � Guide d'Utilisation

### Se Connecter
1. Ouvrez http://localhost:5173
2. Cliquez sur "INSCRIPTION" pour créer un compte
3. Entrez un nom d'utilisateur et mot de passe
4. Ou utilisez "CONNEXION" si vous avez déjà un compte

### Créer un Salon
1. Cliquez sur le bouton **+** dans la barre latérale gauche
2. Entrez le nom du salon
3. Cliquez sur "CREER"
4. Le salon apparaît comme icône dans la barre latérale
5. Partagez le code à 6 caractères avec vos amis

### Rejoindre un Salon
1. Cliquez sur le bouton **+** dans la barre latérale
2. Entrez le code à 6 caractères
3. Cliquez sur "REJOINDRE"
4. Vous rejoignez automatiquement le salon

### Naviguer Entre Salons
1. Cliquez sur n'importe quelle **icône de serveur** dans la barre latérale
2. Le salon se charge instantanément
3. L'icône active est colorée en bleu
4. Cliquez sur **H (Home)** pour retourner à l'accueil

### Envoyer des Messages
1. Tapez votre message dans le champ en bas
2. Cliquez sur **→** ou appuyez sur Entrée
3. Le message apparaît instantanément pour tous

### Dessiner des Messages
1. Cliquez sur le bouton **✏ (Dessiner)**
2. Le panneau de dessin apparaît
3. Utilisez les outils :
   - **P (Stylo)** - Dessiner avec la couleur sélectionnée
   - **E (Gomme)** - Effacer (utilise la couleur de fond du thème)
   - **C (Effacer)** - Tout effacer
   - **Palette** - Choisissez parmi 6 couleurs
   - **TAILLE** - Ajustez l'épaisseur du trait
4. Tapez un message texte (optionnel)
5. Cliquez sur **→** pour envoyer

### Changer de Thème
1. Cliquez sur le bouton **🌙/☀** dans la barre latérale des salons
2. Le thème bascule entre sombre et clair
3. Le canvas de dessin utilise noir (sombre) ou blanc (clair)
4. Votre préférence est sauvegardée automatiquement

## 🌓 Mode Sombre

### Par Défaut
- **Mode sombre activé par défaut** au premier lancement
- Arrière-plans gris foncés (#1a1a1a, #2a2a2a, #333)
- Texte blanc et bordures blanches
- **Canvas de dessin noir** pour dessins en couleurs vives

### Mode Clair
- Arrière-plans blancs et gris clairs
- Texte noir et bordures noires
- **Canvas de dessin blanc** pour look classique PictoChatter (recommandé 12px)

### Canvas Adaptatif
- Le canvas suit automatiquement le thème actuel
- La gomme efface avec la couleur de fond du thème
- Les nouveaux dessins utilisent l'arrière-plan du thème actuel

## 🎨 Système de Design Rétro

### Préservé du PictoChatter Original
✅ Police bitmap Press Start 2P
✅ Bordures carrées dures (0px border-radius)
✅ Couleurs plates (pas de dégradés)
✅ Rendu pixel-perfect
✅ Bordures 2-3px
✅ Interface texte uniquement (pas d'icônes fantaisies)

### Améliorations Modernes
✅ Mode sombre/clair
✅ Layout Discord plein écran
✅ Messages groupés avec avatars
✅ Navigation rapide par icônes
✅ WCAG AAA accessibilité
✅ Cibles tactiles 44px
✅ Entièrement responsive

## 📦 Déploiement en Production

### Méthode 1 : VPS (Ubuntu/Debian)

#### 1. Préparer le Serveur

```bash
# Mise à jour système
sudo apt update && sudo apt upgrade -y

# Installer Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Installer PM2
sudo npm install -g pm2

# Installer nginx
sudo apt install -y nginx
```

#### 2. Cloner et Configurer

```bash
# Cloner le dépôt
git clone <votre-repo-url> PictoChatter
cd PictoChatter

# Installer les dépendances
npm install
cd client && npm install && cd ..

# Build le client
npm run build
```

#### 3. Variables d'Environnement Production

Éditez `.env` :
```env
PORT=3000
CLIENT_URL=https://votre-domaine.com
JWT_SECRET=CHANGEZ_CECI_PAR_UNE_CLE_TRES_SECURISEE
```

#### 4. Lancer avec PM2

```bash
pm2 start server/index.js --name PictoChatter
pm2 save
pm2 startup
```

#### 5. Configurer Nginx

```bash
sudo nano /etc/nginx/sites-available/PictoChatter
```

```nginx
server {
    listen 80;
    server_name votre-domaine.com www.votre-domaine.com;

    # Fichiers statiques
    location / {
        root /chemin/vers/PictoChatter/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/PictoChatter /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 6. SSL avec Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d votre-domaine.com -d www.votre-domaine.com
```

## 🔧 Personnalisation

### Changer les Couleurs

Éditez `client/src/style.css` :

```css
:root {
  --accent-blue: #4477EE;
  --accent-green: #00AA00;
  /* etc. */
}

[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --bg-secondary: #2a2a2a;
  /* etc. */
}
```

### Ajouter des Couleurs au Canvas

Dans `client/src/main.ts`, trouvez la section color picker :

```html
<button class="color-button" style="background: #votre-couleur;" data-color="#votre-couleur"></button>
```

### Changer la Largeur des Barres Latérales

Dans `client/src/style.css` :

```css
:root {
  --sidebar-width: 72px; /* Barre serveurs */
  --channel-list-width: 240px; /* Barre salons */
}
```

### Passer en Anglais

Recherchez et remplacez tous les textes français par leurs équivalents anglais dans `client/src/main.ts`.

### Retour au Mode Clair par Défaut

Dans `client/src/main.ts`, ligne ~50 :

```typescript
// Changer true en false
this.darkMode = savedTheme === null ? false : savedTheme === 'dark';
```

## 🐛 Dépannage

### Échec de Connexion Socket

Vérifiez que :
1. Le serveur tourne
2. CORS est correctement configuré dans `.env`
3. Le pare-feu autorise le port
4. L'URL API dans `client/.env` est correcte

## 📄 Structure du Projet

```
PictoChatter/
├── server/
│   └── index.js                 # Serveur Express + Socket.io
├── client/
│   ├── src/
│   │   ├── main.ts              # Logique frontend principale
│   │   └── style.css            # Design rétro Nintendo DS
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── package.json                 # Package racine
├── .env                         # Variables d'environnement serveur
├── README.md                    # Ce fichier
├── FRANCAIS.md                  # Documentation en français
├── DISCORD_LAYOUT.md            # Guide du layout Discord
├── ACCESSIBILITY.md             # Guide accessibilité
└── RETRO_DESIGN.md              # Système de design rétro
```

## 📚 Documentation

- **README.md** - Guide principal (ce fichier)
- **FRANCAIS.md** - Détails sur l'interface française et le mode sombre
- **DISCORD_LAYOUT.md** - Architecture Discord avec design rétro
- **ACCESSIBILITY.md** - Fonctionnalités d'accessibilité (WCAG AAA)
- **RETRO_DESIGN.md** - Système de design Nintendo DS
- **QUICKSTART.md** - Guide rapide utilisateur
- **FEATURES.md** - Fonctionnalités futures planifiées
- **API.md** - Documentation de l'API

## 🎯 Fonctionnalités Clés

### ✅ Implémenté
- [x] Authentification JWT sécurisée (expirable)
- [x] Chat en temps réel (Socket.io)
- [x] Salons multiples avec codes
- [x] Canvas de dessin PictoChatter
- [x] Messages texte + dessin
- [x] Layout Discord avec barres latérales
- [x] Mode sombre/clair avec basculement
- [x] Interface 100% en français
- [x] Canvas adaptatif au thème
- [x] Messages groupés par utilisateur
- [x] Avatars avec lettres
- [x] Navigation rapide par icônes
- [x] Responsive (desktop, tablette, mobile)
- [x] Accessibilité WCAG AAA (font-size 12px)
- [x] Rendu pixel-perfect
- [x] Messages privés (DMs)
- [x] Chat vocal (Salons vocaux)
- [x] Appels privés avec amis (WebRTC)
- [x] Sécurité renforcée (XSS, CSP, HPP)

### 🚀 Planifié
- [ ] @mentions
- [ ] Réactions aux messages
- [ ] Indicateurs de statut utilisateur
- [ ] Modification de messages
- [ ] Partage de fichiers (Photos/Vidéos)
- [ ] Paramètres de serveur avancés#   P i c t o C h a t t e r  
 