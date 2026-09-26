// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import {sqliteTable,text,index} from 'drizzle-orm/sqlite-core';
export const projects=sqliteTable('projects',{id:text('id').primaryKey(),owner:text('owner').notNull(),data:text('data').notNull(),updatedAt:text('updated_at').notNull()},t=>[index('projects_owner_updated').on(t.owner,t.updatedAt)]);
export const modelVersions=sqliteTable('model_versions',{id:text('id').primaryKey(),projectId:text('project_id').notNull(),owner:text('owner').notNull(),objectKey:text('object_key').notNull(),metadata:text('metadata').notNull(),createdAt:text('created_at').notNull()},t=>[index('model_versions_project_owner').on(t.projectId,t.owner)]);
export const audit=sqliteTable('audit_events',{id:text('id').primaryKey(),owner:text('owner').notNull(),projectId:text('project_id').notNull(),event:text('event').notNull(),createdAt:text('created_at').notNull()},t=>[index('audit_project_owner').on(t.projectId,t.owner)]);
export const runs=sqliteTable('simulation_runs',{id:text('id').primaryKey(),owner:text('owner').notNull(),projectId:text('project_id').notNull(),modelHash:text('model_hash').notNull(),status:text('status').notNull(),data:text('data').notNull(),createdAt:text('created_at').notNull()},t=>[index('runs_owner_project_created').on(t.owner,t.projectId,t.createdAt)]);
