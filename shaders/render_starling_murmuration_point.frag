// _starling_murmuration_render.frag
// Flocking boids: render pass for 100k+ GPU-simulated agents
// This is the VISUALIZATION shader; actual simulation runs in update shaders via GPGPU

precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

// Pseudo-random
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

// 3D rotation (for flock orientation)
mat2 rot2(float a) {
    return mat2(cos(a), -sin(a), sin(a), cos(a));
}

// Fake boid positions for this starter (in real use, read from position texture)
// We generate deterministic "flocking" motion using layered noise
vec2 boidPosition(float id, float t) {
    // Large-scale drift
    vec2 drift = vec2(
        sin(t * 0.1 + id * 0.7) * 0.3,
        cos(t * 0.08 + id * 0.5) * 0.2
    );
    
    // Medium-scale flocking behavior
    vec2 flock = vec2(
        sin(t * 0.5 + id * 0.3) * 0.15,
        cos(t * 0.4 + id * 0.4) * 0.15
    );
    
    // Small-scale jitter (individual behavior)
    vec2 jitter = vec2(
        sin(t * 2.0 + id * 1.7) * 0.02,
        cos(t * 1.8 + id * 1.3) * 0.02
    );
    
    return drift + flock + jitter;
}

float boidSpeed(float id, float t) {
    return 0.5 + 0.5 * sin(t * 0.3 + id * 0.2);
}

// Render a single boid as a soft point
float boidPoint(vec2 uv, vec2 pos, float speed) {
    float d = length(uv - pos);
    // Size varies with speed (faster = stretched, but we use point sprites here)
    float size = 0.003 + 0.002 * speed;
    return smoothstep(size, 0.0, d);
}

// Motion blur trail (fake, for starter)
float boidTrail(vec2 uv, vec2 pos, vec2 vel, float speed) {
    vec2 toBoid = pos - uv;
    float alongVel = dot(toBoid, normalize(vel));
    float perpVel = length(toBoid - alongVel * normalize(vel));
    
    float trailLength = 0.01 * speed;
    float inTrail = step(0.0, alongVel) * step(alongVel, trailLength) * smoothstep(0.003, 0.0, perpVel);
    return inTrail * smoothstep(trailLength, 0.0, alongVel);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    
    // Dark sky background
    vec3 color = vec3(0.02, 0.03, 0.06);
    
    // Simulate 1000 boids (in real implementation, 100k+ from texture)
    float numBoids = 1000.0;
    
    for (float i = 0.0; i < 1000.0; i += 1.0) {
        if (i >= numBoids) break;
        
        float id = i / numBoids;
        vec2 pos = boidPosition(id, u_time);
        float speed = boidSpeed(id, u_time);
        
        // Velocity for trail direction
        vec2 vel = vec2(
            sin(u_time * 0.5 + id * 0.3),
            cos(u_time * 0.4 + id * 0.4)
        ) * speed * 0.01;
        
        // Point
        float point = boidPoint(uv, pos, speed);
        
        // Trail
        float trail = boidTrail(uv, pos, vel, speed);
        
        // Color: darker boids at back, lighter at front
        // + depth cue from y position
        float depth = 0.5 + 0.5 * pos.y;
        vec3 boidColor = mix(
            vec3(0.1, 0.1, 0.15),
            vec3(0.8, 0.85, 0.9),
            depth
        );
        
        // Add to output
        color += boidColor * point * 0.8;
        color += boidColor * trail * 0.2 * speed;
    }
    
    // Subtle vignette
    float vignette = 1.0 - dot(uv, uv) * 0.5;
    color *= vignette;
    
    // Tone mapping
    color = color / (1.0 + color * 0.5);
    
    gl_FragColor = vec4(color, 1.0);
}
