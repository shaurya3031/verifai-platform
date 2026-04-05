/**
 * VerifAI — Shader Background Animation
 * Implementation of the liquid ripple shader from 21st.dev
 */

const initShader = () => {
    const container = document.getElementById('shader-container');
    if (!container) return;

    // Vertex shader
    const vertexShader = `
      void main() {
        gl_Position = vec4( position, 1.0 );
      }
    `;

    // Fragment shader (Customized with branding tint)
    const fragmentShader = `
      #define TWO_PI 6.2831853072
      #define PI 3.14159265359

      precision highp float;
      uniform vec2 resolution;
      uniform float time;

      void main(void) {
        vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
        float t = time * 0.04;
        float lineWidth = 0.0015;

        vec3 color = vec3(0.0);
        
        // Loop for R, G, B channels
        for(int j = 0; j < 3; j++){
          for(int i = 0; i < 5; i++){
            float layer = fract(t - 0.01 * float(j) + float(i) * 0.01);
            float dist = abs(layer * 5.0 - length(uv) + mod(uv.x + uv.y, 0.2));
            color[j] += lineWidth * float(i * i) / dist;
          }
        }
        
        // Subtly enhance blue and purple tones
        color.r *= 0.6; // Reduce red slightly
        color.g *= 0.4; // Reduce green more for purple feel
        color.b *= 1.2; // Boost blue
        
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    // Initialize Three.js scene
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    camera.position.z = 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
        time: { type: "f", value: 1.0 },
        resolution: { type: "v2", value: new THREE.Vector2() },
    };

    const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const onWindowResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height);
        uniforms.resolution.value.x = renderer.domElement.width;
        uniforms.resolution.value.y = renderer.domElement.height;
    };

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    const animate = () => {
        requestAnimationFrame(animate);
        uniforms.time.value += 0.05;
        renderer.render(scene, camera);
    };

    animate();
};

// Initialize when library is loaded
if (window.THREE) {
    initShader();
} else {
    console.warn('Three.js not found for shader background.');
}
