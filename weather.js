/* ============================================
   VerifAI — Weather Verification Logic
   Powered by Open-Meteo & Nominatim
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    const locBtn = document.getElementById('locBtn');
    const permissionState = document.getElementById('permissionState');
    const loadingState = document.getElementById('loadingState');
    const dataState = document.getElementById('dataState');
    const forecastSection = document.getElementById('forecastSection');
    const forecastGrid = document.getElementById('forecastGrid');

    // UI Elements
    const cityNameEl = document.getElementById('cityName');
    const currentTempEl = document.getElementById('currentTemp');
    const weatherIconEl = document.getElementById('weatherIcon');
    const weatherTextEl = document.getElementById('weatherText');
    const humidityEl = document.getElementById('humidity');
    const windSpeedEl = document.getElementById('windSpeed');
    const uvIndexEl = document.getElementById('uvIndex');
    const currentDateEl = document.getElementById('currentDate');

    // Set Current Date
    const today = new Date();
    currentDateEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Weather Code Mapping (WMO Code)
    const weatherCodes = {
        0: { text: 'Clear Skies', icon: '☀️' },
        1: { text: 'Mainly Clear', icon: '🌤️' },
        2: { text: 'Partly Cloudy', icon: '⛅' },
        3: { text: 'Overcast', icon: '☁️' },
        45: { text: 'Foggy', icon: '🌫️' },
        48: { text: 'Depositing Rime Fog', icon: '🌫️' },
        51: { text: 'Light Drizzle', icon: '🌦️' },
        53: { text: 'Moderate Drizzle', icon: '🌧️' },
        55: { text: 'Dense Drizzle', icon: '🌧️' },
        61: { text: 'Slight Rain', icon: '🌦️' },
        63: { text: 'Moderate Rain', icon: '🌧️' },
        65: { text: 'Heavy Rain', icon: '⛈️' },
        71: { text: 'Slight Snowfall', icon: '🌨️' },
        73: { text: 'Moderate Snowfall', icon: '❄️' },
        75: { text: 'Heavy Snowfall', icon: '❄️' },
        95: { text: 'Thunderstorm', icon: '🌩️' }
    };

    const getWeekDay = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    };

    const fetchWeather = async (lat, lon) => {
        try {
            // Determine Backend URL (Auto-detect if running on port 3000 or default to localhost)
            const BACKEND_URL = window.location.port === '3000' ? '' : 'http://localhost:3000';

            // 1. Fetch Location Name (via Proxy or Fallback)
            let city = 'Verified Region';
            let country = 'Earth';
            
            try {
                const locRes = await fetch(`${BACKEND_URL}/api/proxy/location?lat=${lat}&lon=${lon}`);
                const locData = await locRes.json();
                if (locData && locData.address) {
                    city = locData.address.city || locData.address.town || locData.address.village || 'Your Region';
                    country = locData.address.country || '';
                }
            } catch (err) {
                console.warn('⚠️ Location name failed, using fallback.', err.message);
            }
            
            cityNameEl.textContent = country ? `${city}, ${country}` : city;

            // Multi-Route Fetching (Tries Proxy then Direct Fallback)
            let data;
            const fetchRoutes = [
                `${BACKEND_URL}/api/proxy/weather?lat=${lat}&lon=${lon}`,
                `http://127.0.0.1:3000/api/proxy/weather?lat=${lat}&lon=${lon}`,
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max&timezone=auto`
            ];

            for (const route of fetchRoutes) {
                try {
                    console.log(`🌐 Attempting route: ${route}`);
                    const res = await fetch(route);
                    if (!res.ok) throw new Error('Route offline');
                    data = await res.json();
                    if (data.current) break; // Success!
                } catch (e) {
                    console.warn(`⚠️ Route failed: ${route}`, e.message);
                    continue;
                }
            }

            if (!data) throw new Error('Total network failure: All 3 weather routes blocked.');

            // Update Current Weather
            const current = data.current;
            const daily = data.daily;
            const code = weatherCodes[current.weather_code] || { text: 'Unknown', icon: '🌍' };

            currentTempEl.textContent = Math.round(current.temperature_2m);
            weatherIconEl.textContent = code.icon;
            weatherTextEl.textContent = code.text;
            humidityEl.textContent = `${current.relative_humidity_2m}%`;
            windSpeedEl.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
            
            // Normalize UV Index from any provider
            const uv = (daily && daily.uv_index_max) ? daily.uv_index_max[0] : (current.uv_index || 0);
            let uvText = 'Low';
            if (uv > 2) uvText = 'Moderate';
            if (uv > 5) uvText = 'High';
            if (uv > 7) uvText = 'Very High';
            if (uv > 10) uvText = 'Extreme';
            uvIndexEl.textContent = `${uvText} (${Math.round(uv)})`;

            // Render Weekly Forecast
            if (daily && daily.time) {
                forecastGrid.innerHTML = daily.time.map((time, i) => {
                    const dayCode = weatherCodes[daily.weather_code[i]] || { icon: '🌍' };
                    return `
                        <div class="forecast-card glass reveal stagger-${i+1}">
                            <span class="forecast-day">${getWeekDay(time)}</span>
                            <span class="forecast-icon">${dayCode.icon}</span>
                            <div class="forecast-temp">
                                ${Math.round(daily.temperature_2m_max[i])}°
                                <span>${Math.round(daily.temperature_2m_min[i])}°</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // Transition UI
            loadingState.classList.add('hidden');
            dataState.classList.remove('hidden');
            forecastSection.classList.remove('hidden');
            forecastSection.classList.add('active');
            
            // Re-trigger animations for dynamically added forecast cards
            if (typeof initScrollReveals === 'function') {
                initScrollReveals();
            }

        } catch (err) {
            console.error('❌ Weather Verification Error:', err);
            
            let diagnosticInfo = `\n\nDiagnostic: ${err.message}`;
            if (err.message === 'Failed to fetch') {
                diagnosticInfo += '\n- Possible: Server not running or blocked by Firewall.';
            }
            
            alert('Atmospheric verification failed.' + diagnosticInfo);
            loadingState.classList.add('hidden');
            permissionState.classList.remove('hidden');
        }
    };

    const handleLocation = () => {
        permissionState.classList.add('hidden');
        loadingState.classList.remove('hidden');

        console.log('🌍 Weather Verification: Requesting coordinates...');

        if (!navigator.geolocation) {
            console.error('❌ Geolocation Error: Browser not supported');
            alert('Your browser does not support Geolocation verification.');
            loadingState.classList.add('hidden');
            permissionState.classList.remove('hidden');
            return;
        }

        const geoOptions = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                console.log(`✅ Coordinates obtained: ${latitude}, ${longitude}`);
                fetchWeather(latitude, longitude);
            },
            (err) => {
                console.warn('❌ Geolocation Permission Denied or Timed Out:', err.message);
                alert('Permission denied or request timed out. Atmospheric verification requires location access.');
                loadingState.classList.add('hidden');
                permissionState.classList.remove('hidden');
            },
            geoOptions
        );
    };

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- UI Animations & Reveals ---
    const initScrollReveals = () => {
        const revealOptions = {
            threshold: 0.15,
            rootMargin: '0px 0px -50px 0px'
        };

        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                }
            });
        }, revealOptions);

        document.querySelectorAll('.reveal').forEach(el => {
            revealObserver.observe(el);
        });
    };

    const initMouseTracking = () => {
        document.addEventListener('mousemove', (e) => {
            const x = (e.clientX / window.innerWidth) * 100;
            const y = (e.clientY / window.innerHeight) * 100;
            document.documentElement.style.setProperty('--mouse-x', `${x}%`);
            document.documentElement.style.setProperty('--mouse-y', `${y}%`);
        });
    };

    const initMagneticButtons = () => {
        const magneticEls = document.querySelectorAll('.magnetic');
        magneticEls.forEach(el => {
            el.addEventListener('mousemove', function(e) {
                const rect = this.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                this.style.transform = `translate(${x * 0.3}px, ${y * 0.5}px)`;
            });
            el.addEventListener('mouseleave', function() {
                this.style.transform = 'translate(0, 0)';
            });
        });
    };

    // Initialize UI
    initScrollReveals();
    initMouseTracking();
    initMagneticButtons();

    // Initial triggers for above-the-fold content
    setTimeout(() => {
        const heroReveals = document.querySelectorAll('.weather-hero .reveal');
        heroReveals.forEach(el => el.classList.add('active'));
    }, 100);

    locBtn.addEventListener('click', handleLocation);
});
