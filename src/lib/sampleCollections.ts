export const SAMPLE_COLLECTIONS = [
  {
    id: 'default',
    label: 'Default sample',
    description: 'Balanced API collection with clean structure',
    path: '/samples/default.postman_collection.json',
    filename: 'sample-default.postman_collection.json',
  },
  {
    id: 'messy-large',
    label: 'Enterprise messy demo',
    description: '140+ requests, duplicates, deep nesting, uneven auth/method mix',
    path: '/samples/messy-large.postman_collection.json',
    filename: 'sample-messy-large.postman_collection.json',
  },
  {
    id: 'secrets-auth',
    label: 'Secrets + auth sample',
    description: 'Contains exposed secrets and varied auth schemes',
    path: '/samples/secrets-auth.postman_collection.json',
    filename: 'sample-secrets-auth.postman_collection.json',
  },
  {
    id: 'security-issues',
    label: 'Security issues sample',
    description: 'Intentionally vulnerable collection with many findings',
    path: '/samples/security-issues.postman_collection.json',
    filename: 'sample-security-issues.postman_collection.json',
  },
] as const

export type SampleCollectionId = (typeof SAMPLE_COLLECTIONS)[number]['id']

export async function loadSampleCollection(id: SampleCollectionId): Promise<string> {
  const selected = SAMPLE_COLLECTIONS.find((s) => s.id === id) ?? SAMPLE_COLLECTIONS[0]
  const response = await fetch(selected.path)
  if (!response.ok) {
    throw new Error(`Failed to load sample collection (${response.status})`)
  }
  const json = await response.json()
  return JSON.stringify(json)
}
