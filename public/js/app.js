/*
   DJI Drone RTMP Live Stream Dashboard (MediaMTX Edition)
   Frontend application
*/

(function () {
    'use strict';

    const CONFIG = {
        API_BASE: window.location.origin,
        POLL_INTERVAL: 1000,
    };

    const DEFAULT_SERVER = {
        localIP: '',
        rtmpPort: 1935,
        rtspPort: 8554,
        hlsPort: 8888,
        webrtcPort: 8889,
        dashboardPort: 3000
    };

    const state = {
        currentStream: null,
        currentPlaybackUrl: '',
        isPlaying: false,
        pollTimer: null,
        uptimeTimer: null,
        serverOnline: false,
        streams: [],
        serverInfo: { ...DEFAULT_SERVER },
        lastQrUrls: {},
        uptimeSnapshot: 0,
        uptimeUpdatedAt: 0
    };

    const DOM = {
        videoPlayer: document.getElementById('videoPlayer'), // This is now an iframe
        playerOverlay: document.getElementById('playerOverlay'),
        playerContainer: document.getElementById('playerContainer'),
        playerPlaceholder: document.querySelector('.player-placeholder'),
        placeholderText: document.querySelector('.placeholder-text'),
        placeholderHint: document.querySelector('.placeholder-hint'),
        fullscreenBtn: document.getElementById('fullscreenBtn'),
        fullscreenEnterIcon: document.querySelector('.fullscreen-enter-icon'),
        fullscreenExitIcon: document.querySelector('.fullscreen-exit-icon'),
        liveBadge: document.getElementById('liveBadge'),
        streamTitle: document.getElementById('streamTitle'),
        streamSelector: document.getElementById('streamSelector'),
        serverStatus: document.getElementById('serverStatus'),
        shutdownBtn: document.getElementById('shutdownBtn'),
        serverUptime: document.getElementById('serverUptime'),
        streamCount: document.getElementById('streamCount'),
        streamStatsOverlay: document.getElementById('streamStatsOverlay'),
        infoStatus: document.getElementById('infoStatus'),
        infoStreamKey: document.getElementById('infoStreamKey'),
        infoDuration: document.getElementById('infoDuration'),
        infoCodec: document.getElementById('infoCodec'),
        infoResolution: document.getElementById('infoResolution'),
        infoFps: document.getElementById('infoFps'),
        infoBitrate: document.getElementById('infoBitrate'),
        infoLatency: document.getElementById('infoLatency'),
        overlayResolution: document.getElementById('overlayResolution'),
        overlayFps: document.getElementById('overlayFps'),
        overlayBitrate: document.getElementById('overlayBitrate'),
        obsRtmpUrl: document.getElementById('obsRtmpUrl'),
        obsWebrtcUrl: document.getElementById('obsWebrtcUrl'),
        obsRtspUrl: document.getElementById('obsRtspUrl'),
        djiRtmpUrl: document.getElementById('djiRtmpUrl'),
        lanDashboardUrl: document.getElementById('lanDashboardUrl'),
        lanQrCode: document.getElementById('lanQrCode'),
        lanQrText: document.getElementById('lanQrText'),
        sideDjiRtmpUrl: document.getElementById('sideDjiRtmpUrl'),
        sideDjiQrCode: document.getElementById('sideDjiQrCode'),
        sideDashboardUrl: document.getElementById('sideDashboardUrl'),
        sideDashboardQrCode: document.getElementById('sideDashboardQrCode'),
        sideWebrtcUrl: document.getElementById('sideWebrtcUrl'),
        sideWebrtcQrCode: document.getElementById('sideWebrtcQrCode'),
        sideHlsItem: document.getElementById('sideHlsItem'),
        sideHlsUrl: document.getElementById('sideHlsUrl'),
        sideHlsQrCode: document.getElementById('sideHlsQrCode'),
        serverIp: document.getElementById('serverIp'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage')
    };

    function init() {
        console.log('DJI Live Stream Dashboard initializing (MediaMTX)...');
        setupCopyButtons();
        setupFullscreenButton();
        setupShutdownButton();
        updateStaticConnectionUrls();
        startUptimeCounter();
        startPolling();
    }

    function createPlayer(webrtcUrl) {
        state.currentPlaybackUrl = webrtcUrl;
        console.log(`Setting iframe player to: ${webrtcUrl}`);
        
        // Use MediaMTX WebRTC embedded player
        DOM.videoPlayer.src = webrtcUrl;
        
        state.isPlaying = true;
        DOM.playerOverlay.classList.add('hidden');
        DOM.liveBadge.classList.add('active');
        DOM.streamStatsOverlay.classList.add('visible');
        
        // We can't get stats directly from cross-origin iframe easily
        DOM.overlayResolution.textContent = 'WebRTC';
        DOM.overlayFps.textContent = 'Ultra Low Latency';
        DOM.overlayBitrate.textContent = 'MediaMTX';
        
        DOM.infoResolution.textContent = 'N/A (WebRTC iframe)';
        DOM.infoFps.textContent = 'N/A';
        DOM.infoBitrate.textContent = 'N/A';
        DOM.infoLatency.textContent = '< 0.5s';
        DOM.infoCodec.textContent = 'H264 / Opus (Auto)';
    }

    function destroyPlayer() {
        if (state.isPlaying) {
            DOM.videoPlayer.src = '';
            state.isPlaying = false;
        }
    }

    function handleStreamEnd(title = 'Stream berakhir') {
        destroyPlayer();
        state.currentStream = null;
        state.currentPlaybackUrl = '';
        DOM.playerOverlay.classList.remove('hidden');
        DOM.liveBadge.classList.remove('active');
        DOM.streamStatsOverlay.classList.remove('visible');
        DOM.streamTitle.textContent = title;
        resetInfoPanel();
        updateStaticConnectionUrls();
    }

    function showIdleState() {
        DOM.playerOverlay.classList.remove('hidden');
        DOM.liveBadge.classList.remove('active');
        DOM.streamStatsOverlay.classList.remove('visible');
        DOM.streamTitle.textContent = 'Menunggu Stream...';
        showPlayerMessage(
            'Menunggu drone terhubung...',
            `Push RTMP stream ke ${buildDefaultPublishUrl()}`,
            false
        );
    }

    function showPlayerMessage(message, hint, isError) {
        if (DOM.placeholderText) {
            DOM.placeholderText.textContent = message;
        }
        if (DOM.placeholderHint) {
            DOM.placeholderHint.textContent = hint || '';
            DOM.placeholderHint.classList.toggle('error', Boolean(isError));
        }
    }

    function startPolling() {
        pollStreams();
        state.pollTimer = setInterval(pollStreams, CONFIG.POLL_INTERVAL);
    }

    async function pollStreams() {
        let streamsLoaded = false;

        try {
            const serverResponse = await fetch(`${CONFIG.API_BASE}/api/server`, { cache: 'no-store' });
            if (serverResponse.ok) {
                applyServerInfo(await serverResponse.json());
            }
        } catch (error) {
            console.warn('Failed to fetch server info:', error);
        }

        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/streams`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`API error ${response.status}`);

            const data = await response.json();
            streamsLoaded = true;
            
            // Check if there's an error from backend (MediaMTX down)
            if (data.error) {
                state.serverOnline = false;
                updateServerStatus(false);
            } else {
                state.serverOnline = true;
                updateServerStatus(true);
            }
            
            handleStreamsUpdate(data);
        } catch (error) {
            state.serverOnline = false;
            updateServerStatus(false);
            console.warn('Failed to fetch streams:', error);
        }

        if (!streamsLoaded && !state.currentStream) {
            DOM.streamCount.textContent = '-';
        }
    }

    function applyServerInfo(serverInfo) {
        state.serverInfo = { ...state.serverInfo, ...serverInfo };
        if (serverInfo.localIP) state.serverInfo.localIP = serverInfo.localIP;
        
        if (typeof serverInfo.uptime === 'number') {
            state.uptimeSnapshot = serverInfo.uptime;
            state.uptimeUpdatedAt = Date.now();
            updateServerUptime(serverInfo.uptime);
        }

        updateStaticConnectionUrls();
        if (state.currentStream) {
            updateOBSUrls(state.currentStream);
        }
    }

    function handleStreamsUpdate(data) {
        const streams = Array.isArray(data.streams) ? data.streams : [];
        state.streams = streams;
        DOM.streamCount.textContent = streams.length;
        updateStreamSelector(streams);

        if (state.currentStream) {
            const stillActive = findCurrentStream();
            if (!stillActive) {
                handleStreamEnd('Stream berakhir');
                if (streams.length === 0) showIdleState();
                return;
            }
            state.currentStream = stillActive;
            updateStreamDuration(stillActive.startTime);
            updateOBSUrls(stillActive);
            return;
        }

        if (streams.length > 0) {
            selectStream(streams[0]);
        } else {
            resetInfoPanel();
            showIdleState();
        }
    }

    function updateStreamSelector(streams) {
        const currentValue = DOM.streamSelector.value;
        while (DOM.streamSelector.options.length > 1) {
            DOM.streamSelector.remove(1);
        }
        streams.forEach((stream) => {
            const option = document.createElement('option');
            option.value = stream.streamPath;
            option.textContent = `${stream.key} (${stream.app})`;
            if (stream.streamPath === currentValue) option.selected = true;
            DOM.streamSelector.appendChild(option);
        });

        DOM.streamSelector.onchange = (event) => {
            const selectedPath = event.target.value;
            if (!selectedPath) return;
            const stream = streams.find((item) => item.streamPath === selectedPath);
            if (stream) selectStream(stream);
        };
    }

    function findCurrentStream() {
        if (!state.currentStream) return null;
        return state.streams.find((stream) => stream.streamPath === state.currentStream.streamPath) || null;
    }

    function selectStream(stream) {
        state.currentStream = stream;
        DOM.streamTitle.textContent = `${stream.key} - Live`;
        setInfoStatus(true);
        DOM.infoStreamKey.textContent = stream.key || '-';
        updateStreamDuration(stream.startTime);
        updateOBSUrls(stream);

        const playbackUrl = getStreamPlaybackUrl(stream);
        createPlayer(playbackUrl);
        DOM.streamSelector.value = stream.streamPath;
    }

    function updateOBSUrls(stream) {
        const obsHost = getPlaybackHost();
        const urls = stream.urls || {};

        if (DOM.obsRtmpUrl) DOM.obsRtmpUrl.textContent = rewriteUrlHost(urls.rtmp, obsHost);
        if (DOM.obsWebrtcUrl) DOM.obsWebrtcUrl.textContent = rewriteUrlHost(urls.webrtc, obsHost);
        if (DOM.obsRtspUrl) DOM.obsRtspUrl.textContent = rewriteUrlHost(urls.rtsp, obsHost);
        
        updateOutputAccessUrls(
            rewriteUrlHost(urls.webrtc, obsHost), 
            rewriteUrlHost(urls.hls, obsHost)
        );
    }

    function getStreamPlaybackUrl(stream) {
        const playbackHost = getPlaybackHost();
        return rewriteUrlHost(stream.urls.webrtc, playbackHost);
    }

    function updateStaticConnectionUrls() {
        const publishUrl = buildDefaultPublishUrl();
        const lanDashboardUrl = buildLanDashboardUrl();

        if (DOM.serverIp) DOM.serverIp.textContent = getPublishHost();
        if (DOM.djiRtmpUrl) DOM.djiRtmpUrl.textContent = publishUrl;
        if (DOM.lanDashboardUrl) DOM.lanDashboardUrl.textContent = lanDashboardUrl;
        
        updateLanQrCode(lanDashboardUrl);
        updatePrimaryAccessUrls(publishUrl, lanDashboardUrl);

        if (!state.currentStream) {
            const obsHost = getPlaybackHost();
            if (DOM.obsRtmpUrl) DOM.obsRtmpUrl.textContent = buildUrl('rtmp', obsHost, getPort('rtmpPort'), '/drone');
            if (DOM.obsWebrtcUrl) DOM.obsWebrtcUrl.textContent = buildUrl('http', obsHost, getPort('webrtcPort'), '/drone/');
            if (DOM.obsRtspUrl) DOM.obsRtspUrl.textContent = buildUrl('rtsp', obsHost, getPort('rtspPort'), '/drone');
            updateOutputAccessUrls(
                buildUrl('http', obsHost, getPort('webrtcPort'), '/drone/'),
                buildUrl('http', obsHost, getPort('hlsPort'), '/drone/index.m3u8')
            );
        }

        if (!state.currentStream && DOM.placeholderHint) {
            DOM.placeholderHint.textContent = `Push RTMP stream ke ${publishUrl}`;
        }
    }

    function updateLanQrCode(url) {
        if (DOM.lanQrText) DOM.lanQrText.textContent = url;
        updateQrImage('lan-dashboard', DOM.lanQrCode, url);
    }

    function updatePrimaryAccessUrls(publishUrl, dashboardUrl) {
        setText(DOM.sideDjiRtmpUrl, publishUrl);
        setText(DOM.sideDashboardUrl, dashboardUrl);
        updateQrImage('side-dji-rtmp', DOM.sideDjiQrCode, publishUrl);
        updateQrImage('side-dashboard', DOM.sideDashboardQrCode, dashboardUrl);
    }

    function updateOutputAccessUrls(webrtcUrl, hlsUrl) {
        setText(DOM.sideWebrtcUrl, webrtcUrl);
        setText(DOM.sideHlsUrl, hlsUrl || 'HLS nonaktif');
        updateQrImage('side-webrtc', DOM.sideWebrtcQrCode, webrtcUrl);
        updateQrImage('side-hls', DOM.sideHlsQrCode, hlsUrl);

        if (DOM.sideHlsItem) {
            DOM.sideHlsItem.classList.toggle('is-disabled', !isQrTargetUrl(hlsUrl));
        }
    }

    function updateQrImage(key, image, url) {
        if (!image) return;
        if (!isQrTargetUrl(url)) {
            image.removeAttribute('src');
            return;
        }
        if (state.lastQrUrls[key] === url) return;

        state.lastQrUrls[key] = url;
        image.src = `${CONFIG.API_BASE}/api/qr/dashboard.svg?url=${encodeURIComponent(url)}`;
    }

    function isQrTargetUrl(url) {
        return typeof url === 'string' && /^(https?|rtmp|rtsp|webrtc):\/\/[^\s]+$/i.test(url);
    }

    function setText(element, value) {
        if (element) element.textContent = value || '';
    }

    function buildDefaultPublishUrl() {
        return buildUrl('rtmp', getPublishHost(), getPort('rtmpPort'), '/drone');
    }

    function buildLanDashboardUrl() {
        const host = state.serverInfo.localIP || getPublishHost();
        return buildUrl('http', host, getPort('dashboardPort'), '');
    }

    function buildUrl(protocol, host, port, urlPath) {
        return `${protocol}://${formatHostForUrl(host)}:${port}${urlPath}`;
    }

    function rewriteUrlHost(rawUrl, host) {
        if (!rawUrl) return rawUrl;
        return rawUrl.replace(/\/\/(\[[^\]]+\]|[^/:]+)(?=:|\/)/, `//${formatHostForUrl(host)}`);
    }

    function formatHostForUrl(host) {
        if (!host) return 'localhost';
        return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    }

    function getBrowserHost() {
        return window.location.hostname || '';
    }

    function getPlaybackHost() {
        return getBrowserHost() || state.serverInfo.localIP || 'localhost';
    }

    function getPublishHost() {
        const browserHost = getBrowserHost();
        if (isLocalHost(browserHost) && state.serverInfo.localIP) {
            return state.serverInfo.localIP;
        }
        return browserHost || state.serverInfo.localIP || 'localhost';
    }

    function isLocalHost(host) {
        return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    }

    function getPort(name) {
        return Number(state.serverInfo[name]) || DEFAULT_SERVER[name];
    }

    function setupFullscreenButton() {
        if (!DOM.fullscreenBtn) return;
        DOM.fullscreenBtn.addEventListener('click', toggleFullscreen);
        document.addEventListener('fullscreenchange', updateFullscreenButton);
        document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
        updateFullscreenButton();
    }

    async function toggleFullscreen() {
        const fullscreenElement = getFullscreenElement();
        try {
            if (fullscreenElement) {
                await exitFullscreen();
            } else {
                await enterFullscreen(DOM.playerContainer);
            }
        } catch (error) {
            console.warn('Fullscreen failed:', error);
            showToast('Fullscreen tidak didukung browser ini', 'error');
        }
    }

    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    async function enterFullscreen(element) {
        if (element.requestFullscreen) {
            await element.requestFullscreen();
            return;
        }
        if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
            return;
        }
        throw new Error('Fullscreen API unavailable');
    }

    async function exitFullscreen() {
        if (document.exitFullscreen) {
            await document.exitFullscreen();
            return;
        }
        if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }

    function updateFullscreenButton() {
        const isFullscreen = Boolean(getFullscreenElement());
        DOM.playerContainer.classList.toggle('is-fullscreen', isFullscreen);
        DOM.fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Fullscreen');
        DOM.fullscreenBtn.setAttribute('title', isFullscreen ? 'Exit fullscreen' : 'Fullscreen');
        DOM.fullscreenEnterIcon.classList.toggle('hidden', isFullscreen);
        DOM.fullscreenExitIcon.classList.toggle('hidden', !isFullscreen);
    }

    function setupShutdownButton() {
        if (!DOM.shutdownBtn) return;
        DOM.shutdownBtn.addEventListener('click', async () => {
            const confirmed = window.confirm('Matikan server live streaming sekarang? Dashboard akan offline sampai server dijalankan lagi.');
            if (!confirmed) return;

            DOM.shutdownBtn.disabled = true;
            DOM.shutdownBtn.classList.add('loading');
            showToast('Mematikan server...');

            try {
                const response = await fetch(`${CONFIG.API_BASE}/api/shutdown`, {
                    method: 'POST',
                    cache: 'no-store'
                });
                if (!response.ok) throw new Error(`Shutdown failed: ${response.status}`);
                updateServerStatus(false);
                DOM.serverStatus.querySelector('span').textContent = 'Server Stopping';
                showToast('Server dimatikan');
                stopClientTimers();
                destroyPlayer();
            } catch (error) {
                console.warn('Shutdown request failed:', error);
                DOM.shutdownBtn.disabled = false;
                DOM.shutdownBtn.classList.remove('loading');
                showToast('Gagal mematikan server', 'error');
            }
        });
    }

    function stopClientTimers() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
        if (state.uptimeTimer) {
            clearInterval(state.uptimeTimer);
            state.uptimeTimer = null;
        }
    }

    function updateServerStatus(online) {
        DOM.serverStatus.classList.toggle('offline', !online);
        DOM.serverStatus.querySelector('span').textContent = online ? 'Server Online' : 'MediaMTX Offline';
    }

    function startUptimeCounter() {
        state.uptimeTimer = setInterval(() => {
            if (!state.uptimeUpdatedAt) return;
            const elapsed = (Date.now() - state.uptimeUpdatedAt) / 1000;
            updateServerUptime(state.uptimeSnapshot + elapsed);
        }, 1000);
    }

    function updateServerUptime(uptimeSeconds) {
        DOM.serverUptime.textContent = formatDuration(uptimeSeconds);
    }

    function updateStreamDuration(startTimeString) {
        if (!startTimeString) {
            DOM.infoDuration.textContent = '-';
            return;
        }
        const start = new Date(startTimeString).getTime();
        if (isNaN(start)) {
            DOM.infoDuration.textContent = '-';
            return;
        }
        const elapsed = (Date.now() - start) / 1000;
        DOM.infoDuration.textContent = formatDuration(elapsed);
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return [
            h.toString().padStart(2, '0'),
            m.toString().padStart(2, '0'),
            s.toString().padStart(2, '0')
        ].join(':');
    }

    function setInfoStatus(isLive) {
        const badge = DOM.infoStatus.querySelector('.status-badge');
        if (!badge) return;
        badge.className = `status-badge ${isLive ? 'online' : 'offline'}`;
        badge.textContent = isLive ? 'Live' : 'Offline';
    }

    function resetInfoPanel() {
        setInfoStatus(false);
        DOM.infoStreamKey.textContent = '-';
        DOM.infoDuration.textContent = '00:00:00';
        DOM.infoCodec.textContent = '-';
        DOM.infoResolution.textContent = '-';
        DOM.infoFps.textContent = '-';
        DOM.infoBitrate.textContent = '-';
        DOM.infoLatency.textContent = '-';
    }

    function setupCopyButtons() {
        document.querySelectorAll('.copy-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                if (!targetId) return;
                const element = document.getElementById(targetId);
                if (!element) return;
                const text = element.textContent || element.value || '';
                if (!text) return;

                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(text).then(() => {
                        btn.classList.add('copied');
                        showToast('Copied to clipboard');
                        setTimeout(() => btn.classList.remove('copied'), 2000);
                    }).catch((err) => {
                        console.error('Failed to copy:', err);
                        fallbackCopyTextToClipboard(text, btn);
                    });
                } else {
                    fallbackCopyTextToClipboard(text, btn);
                }
            });
        });
    }

    function fallbackCopyTextToClipboard(text, btn) {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            
            // Prevent scrolling to bottom of page in MS Edge.
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.position = "fixed";
            
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                btn.classList.add('copied');
                showToast('Copied to clipboard');
                setTimeout(() => btn.classList.remove('copied'), 2000);
            } else {
                showToast('Gagal menyalin teks', 'error');
            }
        } catch (err) {
            console.error('Fallback copy error:', err);
            showToast('Gagal menyalin teks', 'error');
        }
    }

    let toastTimer = null;
    function showToast(message, type = 'success') {
        if (!DOM.toast || !DOM.toastMessage) return;
        DOM.toastMessage.textContent = message;
        DOM.toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            DOM.toast.classList.remove('show');
            toastTimer = null;
        }, 3000);
    }

    // Initialize the app when the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
