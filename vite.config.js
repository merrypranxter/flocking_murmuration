import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
    plugins: [
        glsl({
            include: [
                '**/*.glsl',
                '**/*.vert',
                '**/*.frag',
            ],
            defaultExtension: 'glsl',
            compress: false,
        }),
    ],
    build: {
        target: 'es2020',
    },
});
