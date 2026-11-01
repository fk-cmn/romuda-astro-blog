// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeCollapsibleCode from './scripts/rehype-collapsible-code.mjs';

// https://astro.build/config
export default defineConfig({
    
    site: 'https://romudanight.top',
    integrations: [
        mdx({
            remarkPlugins: [remarkMath],
            rehypePlugins: [rehypeKatex, rehypeCollapsibleCode],
        }), 
        sitemap()
    ],
    // 3. 核心配置：接入 Markdown 的 LaTeX 渲染插件
    markdown: {
        remarkPlugins: [remarkMath],
        rehypePlugins: [rehypeKatex, rehypeCollapsibleCode],
    },
    
    fonts: [
        {
            provider: fontProviders.local(),
            name: 'Atkinson',
            cssVariable: '--font-atkinson',
            fallbacks: ['sans-serif'],
            options: {
                variants: [
                    {
                        src: ['./src/assets/fonts/atkinson-regular.woff'],
                        weight: 400,
                        style: 'normal',
                        display: 'swap',
                    },
                    {
                        src: ['./src/assets/fonts/atkinson-bold.woff'],
                        weight: 700,
                        style: 'normal',
                        display: 'swap',
                    },
                ],
            },
        },
    ],
});