# 博客维护

在本项目目录运行命令。Agnes 聊天已暂时停用，备份位于 `disabled-features/agnes/`，Live2D 看板娘保留。

## 新增文章

在 `src/content/blog/` 下新建文章目录，例如 `my-new-post/index.md`，将配图放在同一目录。文章至少包含以下信息：

```markdown
---
title: "文章标题"
description: "文章简介"
pubDate: 2026-11-01
tags: ["随笔"]
---

文章正文。
```

`tags` 和 `heroImage` 可选。封面可写为 `heroImage: './cover.jpg'`。

运行 `npm run dev` 本地预览，发布前运行 `npm run build`。构建产物位于 `dist/`。

## 撤下文章

将文章目录移到 `src/content/blog/` 以外（例如项目根目录的 `unpublished/`），或者删除相应文章，再运行 `npm run build`。文章将从列表、文章路由、RSS 和站点地图中移除。

目前没有草稿过滤功能，添加 `draft: true` 不会隐藏文章，未来日期也不会阻止发布。文章路径影响访问地址，已发布文章不要随意改名。

## 更新线上网站

本地构建成功后，按原部署平台的方式更新：如果平台已连接 GitHub，则提交、推送到其监听的分支，并确认平台部署成功；如果手动部署，则上传完整的 `dist/`，确保部署会清除旧文章页面。仅修改本地文件不会更新线上网站。

---
# Astro Starter Kit: Blog

```sh
npm create astro@latest -- --template blog
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

Features:

- ✅ Minimal styling (make it your own!)
- ✅ 100/100 Lighthouse performance
- ✅ SEO-friendly with canonical URLs and Open Graph data
- ✅ Sitemap support
- ✅ RSS Feed support
- ✅ Markdown & MDX support

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX documents. Use `getCollection()` to retrieve posts from `src/content/blog/`, and type-check your frontmatter using an optional schema. See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/) to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).
