import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';

export const searchClient = new Client({ node: config.elasticsearchUrl });
export const EMAIL_INDEX = 'scheduled-emails';

export async function indexEmail(email: Record<string, unknown>) {
  try {
    await searchClient.index({ index: EMAIL_INDEX, id: String(email.id), document: email, refresh: 'wait_for' });
  } catch (error) {
    // Search is an enhancement; Postgres remains the source of truth.
    console.warn('Email search indexing is temporarily unavailable:', error instanceof Error ? error.message : error);
  }
}

export async function findEmails(userId: string, query: string) {
  const result = await searchClient.search({ index: EMAIL_INDEX, query: {
    bool: { filter: [{ term: { userId } }], must: [{ multi_match: { query, fields: ['recipient', 'subject', 'body'] } }] },
  } });
  return result.hits.hits.map(hit => hit._source);
}
