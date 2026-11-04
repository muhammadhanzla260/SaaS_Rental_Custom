/**
 * The site's "CMS": Markdown files in src/content/<collection>/, checked into git.
 * Swap any loader for a headless CMS later without touching the pages.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const vertical = z.enum(['events', 'cars', 'both']).default('both');

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tag: z.enum(['Event rental', 'Car rental', 'Product updates']),
    vertical,
    author: z.string().default('Rent Hatch team'),
    minutes: z.number().optional(),
    featured: z.boolean().default(false),
    /** Samples ship as drafts: built locally, never published or indexed. */
    draft: z.boolean().default(false),
  }),
});

const help = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/help' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['Getting started', 'Bookings & pricing', 'Payments', 'Email & SMS', 'Crews & event day', 'Account & billing', 'Fleet & vehicles']),
    vertical,
    popular: z.boolean().default(false),
    updated: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

const changelog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/changelog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.enum(['New', 'Improved', 'Fixed', 'Cars'])),
    version: z.string().optional(),
  }),
});

const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    short: z.string(),
    order: z.number(),
    updated: z.coerce.date(),
    /** False until a lawyer has written the final text. */
    final: z.boolean().default(false),
  }),
});

/** Customer stories (S1). Only `approved: true` stories are ever published. */
const stories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/stories' }),
  schema: z.object({
    company: z.string(),
    person: z.string(),
    role: z.string(),
    city: z.string(),
    category: z.enum(['Inflatables & party', 'Tents & furniture', 'AV & staging', 'Tools & equipment', 'Car rental']),
    title: z.string(),
    quote: z.string(),
    metric: z.string(),
    featured: z.boolean().default(false),
    approved: z.boolean().default(false),
  }),
});

/** Open roles (S6). Only `open: true` roles are listed. */
const jobs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/jobs' }),
  schema: z.object({
    title: z.string(),
    team: z.string(),
    location: z.string(),
    type: z.string(),
    open: z.boolean().default(false),
  }),
});

export const collections = { blog, help, changelog, legal, stories, jobs };
