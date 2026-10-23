import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection, type ParsedRequest } from '../src/lib/parser'
import { VIRTUALIZE_ABOVE, computeWindow, scrollTopForRow } from '../src/lib/virtualWindow'
import { allFolderKeys, ancestorFolderKeys, buildRequestTree, filterRequestList, filterTreeNodes, flattenTree, folderKey } from '../src/lib/requestTree'

type Item = { name: string; item?: Item[]; request?: Record<string, unknown> }
const leaf = (name: string, method = 'GET'): Item => ({ name, request: { method, url: `https://api.example.com/${name.replace(/\s/g, '-')}` } })

function sample(): ParsedRequest[] {
  const item: Item[] = [
    leaf('Health'),
    { name: 'Users', item: [leaf('List users'), leaf('Create user', 'POST'), { name: 'Admin', item: [leaf('Delete user', 'DELETE')] }] },
    { name: 'Orders', item: [leaf('List orders')] },
  ]
  return parseCollection({ info: { name: 'T', schema: 'x' }, item }).requests
}

test('window: small lists render completely, long lists only near the viewport', () => {
  const small = computeWindow({ count: VIRTUALIZE_ABOVE, rowHeight: 36, scrollTop: 0, viewportHeight: 500 })
  assert.deepEqual([small.start, small.end, small.virtual], [0, VIRTUALIZE_ABOVE, false])

  const top = computeWindow({ count: 5000, rowHeight: 36, scrollTop: 0, viewportHeight: 500, overscan: 5 })
  assert.equal(top.virtual, true)
  assert.equal(top.start, 0)
  assert.equal(top.end, Math.ceil(500 / 36) + 5)
  assert.equal(top.totalHeight, 5000 * 36)

  const middle = computeWindow({ count: 5000, rowHeight: 36, scrollTop: 36 * 2000, viewportHeight: 500, overscan: 5 })
  assert.equal(middle.start, 1995)
  assert.ok(middle.end - middle.start < 40)

  const bottom = computeWindow({ count: 5000, rowHeight: 36, scrollTop: 5000 * 36 - 500, viewportHeight: 500, overscan: 5 })
  assert.equal(bottom.end, 5000)
  // A scroll position past the end or a zero-height viewport never produces an empty or inverted window.
  const past = computeWindow({ count: 400, rowHeight: 36, scrollTop: 10_000_000, viewportHeight: 0 })
  assert.ok(past.start <= past.end && past.end === 400)
})

test('scrolling to a row moves the least amount', () => {
  assert.equal(scrollTopForRow(9, 36, 0, 360), null)
  assert.equal(scrollTopForRow(10, 36, 0, 360), 36)
  assert.equal(scrollTopForRow(10, 36, 0, 300), 10 * 36 + 36 - 300)
  assert.equal(scrollTopForRow(2, 36, 360, 360), 72)
  assert.equal(scrollTopForRow(0, 36, 0, 360), null)
})

test('flattening shows open folders only and numbers the rows for assistive technology', () => {
  const { root, nodes } = buildRequestTree(sample())
  const closed = flattenTree(root, nodes, new Set())
  assert.deepEqual(closed.map((row) => row.key), ['label:root', 'r:Health', folderKey(['Users']), folderKey(['Orders'])])

  const users = folderKey(['Users'])
  const open = flattenTree(root, nodes, new Set([users]))
  assert.deepEqual(
    open.map((row) => row.key),
    ['label:root', 'r:Health', users, 'r:Users/List users', 'r:Users/Create user', folderKey(['Users', 'Admin']), folderKey(['Orders'])]
  )
  const list = open.find((row) => row.key === 'r:Users/List users')
  assert.ok(list && list.kind === 'request')
  assert.deepEqual([list.level, list.posInSet, list.setSize, open[list.parentIndex].key], [2, 1, 3, users])
  const admin = open.find((row) => row.key === folderKey(['Users', 'Admin']))
  assert.ok(admin && admin.kind === 'folder')
  assert.deepEqual([admin.posInSet, admin.setSize, admin.open], [3, 3, false])

  const all = flattenTree(root, nodes, new Set(), true)
  assert.ok(all.some((row) => row.key === 'r:Users/Admin/Delete user'))
  const folder = all.find((row) => row.key === users)
  assert.ok(folder && folder.kind === 'folder' && folder.count === 3)
})

test('folder keys, ancestors and searching', () => {
  const requests = sample()
  const { root, nodes } = buildRequestTree(requests)
  const deep = requests.find((request) => request.name === 'Delete user')!
  assert.deepEqual(ancestorFolderKeys(deep), [folderKey(['Users']), folderKey(['Users', 'Admin'])])
  assert.deepEqual(allFolderKeys(nodes), [folderKey(['Users']), folderKey(['Users', 'Admin']), folderKey(['Orders'])])

  assert.deepEqual(filterRequestList(root, 'health').map((request) => request.name), ['Health'])
  const found = filterTreeNodes(nodes, 'delete')
  assert.equal(found.length, 1)
  assert.equal(found[0].children[0].requests[0].name, 'Delete user')
  assert.deepEqual(filterTreeNodes(nodes, 'nothing here'), [])
})

test('a very large tree flattens quickly and keeps unique keys', () => {
  const item: Item[] = []
  for (let folder = 0; folder < 400; folder += 1) {
    item.push({ name: `Folder ${folder}`, item: Array.from({ length: 15 }, (_, index) => leaf(`Request ${index}`)) })
  }
  const requests = parseCollection({ info: { name: 'Big', schema: 'x' }, item }).requests
  assert.equal(requests.length, 6000)
  const { root, nodes } = buildRequestTree(requests)
  const started = performance.now()
  const rows = flattenTree(root, nodes, new Set(allFolderKeys(nodes)))
  const elapsed = performance.now() - started
  assert.equal(rows.length, 400 + 6000)
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
  assert.ok(elapsed < 500, `flattening took ${elapsed}ms`)
})
