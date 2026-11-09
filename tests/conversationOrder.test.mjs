import assert from 'node:assert/strict'
import { orderedConversations } from '../src/utils/conversationOrder.js'

const conversations = [
  { id: 'd', status: 'dismissed', updatedAt: '2026-11-09T12:00:00Z' },
  { id: 'p1', status: 'pending', updatedAt: '2026-11-08T12:00:00Z' },
  { id: 'r2', status: 'resolved', updatedAt: '2026-11-09T11:00:00Z' },
  { id: 'w', status: 'waiting', updatedAt: '2026-11-09T10:00:00Z' },
  { id: 'r1', status: 'resolved', createdAt: '2026-11-07T12:00:00Z' },
  { id: 'p2', status: 'pending', updatedAt: '2026-11-09T09:00:00Z' },
]
assert.deepEqual(orderedConversations(conversations).map((item) => item.id), ['w', 'p2', 'p1', 'r2', 'r1', 'd'])
assert.equal(conversations[0].id, 'd', 'Ordering leaves the input unchanged')
console.log('Conversaciones: orden por estado y fecha verificado.')
