import { Router } from 'express'
import {
  buildingListQuery,
  contactListQuery,
  contractListQuery,
  createBuildingBody,
  createContactBody,
  createContractBody,
  createCustomerBody,
  createElevatorBody,
  customerListQuery,
  elevatorListQuery,
  importPreviewBody,
  setBuildingLocationBody,
  terminateContractBody,
  updateBuildingBody,
  updateContactBody,
  updateContractBody,
  updateCustomerBody,
  updateElevatorBody,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as customers from '../service/customers.js'
import * as contacts from '../service/contacts.js'
import * as buildings from '../service/buildings.js'
import * as elevators from '../service/elevators.js'
import * as contracts from '../service/contracts.js'
import * as imports from '../service/imports.js'

export const registryRouter = Router()
registryRouter.use(requireAuth)

const canEdit = requireRole('owner', 'office')

// ---- public QR token (elevators; the rest of the elevator routes are below)
registryRouter.post('/elevators/:id/rotate-token', canEdit, async (req, res) => {
  res.json(await elevators.rotateToken(ctxOf(req), parseId(req)))
})

// ---- customers
registryRouter.get('/customers', async (req, res) => {
  res.json(await customers.list(ctxOf(req), parseQuery(customerListQuery, req)))
})
registryRouter.post('/customers', canEdit, async (req, res) => {
  res.status(201).json(await customers.create(ctxOf(req), parseBody(createCustomerBody, req)))
})
registryRouter.get('/customers/:id', async (req, res) => {
  res.json(await customers.get(ctxOf(req), parseId(req)))
})
registryRouter.patch('/customers/:id', canEdit, async (req, res) => {
  res.json(await customers.update(ctxOf(req), parseId(req), parseBody(updateCustomerBody, req)))
})
registryRouter.delete('/customers/:id', canEdit, async (req, res) => {
  await customers.archive(ctxOf(req), parseId(req))
  res.status(204).end()
})

// ---- contacts
registryRouter.get('/contacts', async (req, res) => {
  res.json(await contacts.list(ctxOf(req), parseQuery(contactListQuery, req)))
})
registryRouter.post('/contacts', canEdit, async (req, res) => {
  res.status(201).json(await contacts.create(ctxOf(req), parseBody(createContactBody, req)))
})
registryRouter.patch('/contacts/:id', canEdit, async (req, res) => {
  res.json(await contacts.update(ctxOf(req), parseId(req), parseBody(updateContactBody, req)))
})
registryRouter.delete('/contacts/:id', canEdit, async (req, res) => {
  await contacts.archive(ctxOf(req), parseId(req))
  res.status(204).end()
})

// ---- buildings
registryRouter.get('/buildings', async (req, res) => {
  res.json(await buildings.list(ctxOf(req), parseQuery(buildingListQuery, req)))
})
registryRouter.get('/buildings/pins', async (req, res) => {
  res.json({ items: await buildings.pins(ctxOf(req)) })
})
registryRouter.post('/buildings', canEdit, async (req, res) => {
  res.status(201).json(await buildings.create(ctxOf(req), parseBody(createBuildingBody, req)))
})
registryRouter.get('/buildings/:id', async (req, res) => {
  res.json(await buildings.get(ctxOf(req), parseId(req)))
})
registryRouter.patch('/buildings/:id', canEdit, async (req, res) => {
  res.json(await buildings.update(ctxOf(req), parseId(req), parseBody(updateBuildingBody, req)))
})
registryRouter.put('/buildings/:id/location', canEdit, async (req, res) => {
  const { lat, lng } = parseBody(setBuildingLocationBody, req)
  res.json(await buildings.setLocation(ctxOf(req), parseId(req), lat, lng))
})
registryRouter.post('/buildings/:id/geocode', canEdit, async (req, res) => {
  res.json(await buildings.geocode(ctxOf(req), parseId(req)))
})
registryRouter.delete('/buildings/:id', canEdit, async (req, res) => {
  await buildings.archive(ctxOf(req), parseId(req))
  res.status(204).end()
})

// ---- elevators
registryRouter.get('/elevators', async (req, res) => {
  res.json(await elevators.list(ctxOf(req), parseQuery(elevatorListQuery, req)))
})
registryRouter.post('/elevators', canEdit, async (req, res) => {
  res.status(201).json(await elevators.create(ctxOf(req), parseBody(createElevatorBody, req)))
})
registryRouter.get('/elevators/:id', async (req, res) => {
  res.json(await elevators.get(ctxOf(req), parseId(req)))
})
registryRouter.patch('/elevators/:id', canEdit, async (req, res) => {
  res.json(await elevators.update(ctxOf(req), parseId(req), parseBody(updateElevatorBody, req)))
})
registryRouter.delete('/elevators/:id', canEdit, async (req, res) => {
  await elevators.archive(ctxOf(req), parseId(req))
  res.status(204).end()
})

// ---- contracts
registryRouter.get('/contracts', async (req, res) => {
  res.json(await contracts.list(ctxOf(req), parseQuery(contractListQuery, req)))
})
registryRouter.post('/contracts', canEdit, async (req, res) => {
  res.status(201).json(await contracts.create(ctxOf(req), parseBody(createContractBody, req)))
})
registryRouter.get('/contracts/:id', async (req, res) => {
  res.json(await contracts.get(ctxOf(req), parseId(req)))
})
registryRouter.patch('/contracts/:id', canEdit, async (req, res) => {
  res.json(await contracts.update(ctxOf(req), parseId(req), parseBody(updateContractBody, req)))
})
registryRouter.post('/contracts/:id/terminate', canEdit, async (req, res) => {
  res.json(
    await contracts.terminate(ctxOf(req), parseId(req), parseBody(terminateContractBody, req)),
  )
})
registryRouter.delete('/contracts/:id', canEdit, async (req, res) => {
  await contracts.archive(ctxOf(req), parseId(req))
  res.status(204).end()
})

// ---- CSV import (preview -> commit)
registryRouter.get('/imports/template.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="Avroleva-import.csv"')
  res.send(imports.templateCsv())
})
registryRouter.get('/imports', canEdit, async (req, res) => {
  res.json({ items: await imports.list(ctxOf(req)) })
})
registryRouter.post('/imports/preview', canEdit, async (req, res) => {
  const body = parseBody(importPreviewBody, req)
  res.status(201).json(await imports.preview(ctxOf(req), body.filename, body.csv))
})
registryRouter.get('/imports/:id', canEdit, async (req, res) => {
  res.json(await imports.get(ctxOf(req), parseId(req)))
})
registryRouter.post('/imports/:id/commit', canEdit, async (req, res) => {
  res.json(await imports.commit(ctxOf(req), parseId(req)))
})
