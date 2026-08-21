import './style.css'
import { createClient, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js'

type Role = 'admin' | 'member'
type Status = 'spent' | 'lent' | 'repaid'
type Entry = { id: string; user_id?: string; title: string; amount: number; date: string; due_date: string | null; category: string; person: string; note: string; status: Status }
type Profile = { id: string; email: string; full_name: string; role: Role }
type AdminUser = Profile & { created_at: string }
type Goal = { id: string; title: string; target_amount: number; saved_amount: number; deadline: string; color: string }
type Person = { id: string; name: string; email: string; phone: string }
type NotificationSettings = { discord_webhook_url: string; reminders_enabled: boolean; reminder_days_before: number }

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const configured = Boolean(url?.startsWith('https://') && key && !key.startsWith('replace-with-'))
const supabase: SupabaseClient | null = configured ? createClient(url!, key!) : null
let currentUser: Profile | null = null
let entries: Entry[] = []
let goals: Goal[] = []
let people: Person[] = []
let settings: NotificationSettings = { discord_webhook_url: '', reminders_enabled: true, reminder_days_before: 1 }
let adminUsers: AdminUser[] = []
let activeView = 'overview'
let selectedPersonId = ''
let editingEntryId = ''
let editingPersonId = ''
let activeFilter = 'All activity'
let authMode: 'sign-in' | 'sign-up' = 'sign-in'
let authError = ''
let dataError = ''
let loading = true
let profileMessage = ''
let entryMessage = ''
let adminMessage = ''
let notificationMessage = ''
let toastMessage = ''

const money = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const longDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const esc = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character)
const errorText = (error: unknown, fallback: string) => { if (error instanceof Error) return error.message; if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message); return fallback }
const currentTheme = () => localStorage.getItem('my-money-theme') || 'dark'
const today = () => new Date().toISOString().slice(0, 10)
function showToast(message: string) { toastMessage = message; window.setTimeout(() => { if (toastMessage === message) { toastMessage = ''; render() } }, 3200) }

async function loadSession() {
  try {
    if (supabase) {
      const { data } = await supabase.auth.getSession()
      if (data.session) await loadProfile(data.session.user)
    }
  } catch (error) {
    dataError = errorText(error, 'Unable to load your database.')
  }
  loading = false
  render()
}

async function loadProfile(user: SupabaseUser) {
  const { data } = await supabase!.from('profiles').select('id,email,full_name,role').eq('id', user.id).single()
  const metadataName = String(user.user_metadata?.full_name || '').trim()
  const fallbackName = metadataName || user.email?.split('@')[0] || 'Member'
  currentUser = data && data.full_name && data.full_name !== 'Member' ? data : { id: user.id, email: user.email || '', full_name: fallbackName, role: data?.role || 'member' }
  await Promise.all([loadEntries(), loadPeople(), loadGoals(), loadSettings(), currentUser.role === 'admin' ? loadAdminUsers() : Promise.resolve()])
  await sendDueReminders()
}

async function loadAdminUsers() {
  const { data, error } = await supabase!.from('profiles').select('id,email,full_name,role,created_at').order('created_at', { ascending: false })
  if (error) throw error
  adminUsers = (data || []) as AdminUser[]
}

async function adminAction(action: 'invite' | 'delete' | 'role' | 'update-profile' | 'reset-password', payload: Record<string, unknown>) {
  const { data, error } = await supabase!.functions.invoke('admin-users', { body: { action, ...payload } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  await loadAdminUsers()
}

async function loadEntries() {
  const { data, error } = await supabase!.from('entries').select('*').order('date', { ascending: false })
  if (error) throw error
  entries = (data || []) as Entry[]
}
async function loadPeople() {
  const { data, error } = await supabase!.from('people').select('id,name,email,phone').eq('user_id', currentUser!.id).order('name')
  if (error) throw error
  people = (data || []) as Person[]
}
async function loadGoals() {
  const { data } = await supabase!.from('goals').select('*').eq('user_id', currentUser!.id).order('created_at', { ascending: false })
  goals = (data || []) as Goal[]
}
async function loadSettings() {
  const { data } = await supabase!.from('notification_settings').select('discord_webhook_url,reminders_enabled,reminder_days_before').eq('user_id', currentUser!.id).maybeSingle()
  if (data) settings = data as NotificationSettings
}
async function saveEntry(entry: Omit<Entry, 'id'>) {
  const { data, error } = await supabase!.from('entries').insert({ ...entry, user_id: currentUser!.id }).select().single()
  if (error) throw error
  entries.unshift(data as Entry)
  showToast('Entry saved.')
}
async function updateEntry(id: string, entry: Omit<Entry, 'id'>) {
  const { data, error } = await supabase!.from('entries').update(entry).eq('id', id).select().single()
  if (error) throw error
  entries = entries.map((item) => item.id === id ? data as Entry : item)
  showToast('Entry updated.')
}
async function savePerson(person: Omit<Person, 'id'>) {
  const { data, error } = await supabase!.from('people').insert({ ...person, user_id: currentUser!.id }).select('id,name,email,phone').single()
  if (error) throw error
  people = [...people, data as Person].sort((first, second) => first.name.localeCompare(second.name))
  showToast('Person saved.')
}
async function updatePerson(id: string, person: Omit<Person, 'id'>) {
  const oldName = people.find((item) => item.id === id)?.name
  const { data, error } = await supabase!.from('people').update(person).eq('id', id).select('id,name,email,phone').single()
  if (error) throw error
  people = people.map((item) => item.id === id ? data as Person : item).sort((first, second) => first.name.localeCompare(second.name))
  entries = entries.map((entry) => entry.person === oldName ? { ...entry, person: person.name } : entry)
  showToast('Person updated.')
}
async function saveGoal(goal: Omit<Goal, 'id'>) {
  const { data, error } = await supabase!.from('goals').insert({ ...goal, user_id: currentUser!.id }).select().single()
  if (error) throw error
  goals.unshift(data as Goal)
  showToast('Goal saved.')
}
async function deleteEntry(id: string) {
  await supabase!.from('entries').delete().eq('id', id)
  entries = entries.filter((entry) => entry.id !== id)
  showToast('Entry deleted.')
}
async function saveSettings() {
  const { error } = await supabase!.from('notification_settings').upsert({ ...settings, user_id: currentUser!.id })
  if (error) throw error
  showToast('Notification settings saved.')
}
async function sendDiscordMessage(content: string, webhook = settings.discord_webhook_url) {
  if (!webhook) throw new Error('Add a Discord webhook URL first.')
  const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => null)
  if (!response?.ok) throw new Error('Discord did not accept the message. Check the webhook URL.')
}
async function saveProfile(fullName: string) {
  const cleanName = fullName.trim()
  if (!cleanName) throw new Error('Please enter a name.')
  const { error } = await supabase!.from('profiles').update({ full_name: cleanName }).eq('id', currentUser!.id)
  if (error) throw error
  currentUser = { ...currentUser!, full_name: cleanName }
  showToast('Profile saved.')
}
async function sendDueReminders() {
  if (!settings.reminders_enabled || !settings.discord_webhook_url) return
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + settings.reminder_days_before)
  const dueEntries = entries.filter((entry) => entry.status === 'lent' && entry.due_date && new Date(`${entry.due_date}T12:00:00`) <= cutoff)
  const outstandingByPerson = new Map<string, number>()
  entries.forEach((entry) => {
    if (!entry.person) return
    const balance = outstandingByPerson.get(entry.person) || 0
    outstandingByPerson.set(entry.person, balance + (entry.status === 'lent' ? entry.amount : entry.status === 'repaid' ? -entry.amount : 0))
  })
  const monthlyReminders = [...outstandingByPerson]
    .filter(([, balance]) => balance > 0)
    .map(([person, balance]) => ({ person, balance, key: `my-money-monthly-${today().slice(0, 7)}-${person}` }))
  const messages = [
    ...dueEntries.map((entry) => ({ key: `my-money-discord-${entry.id}-${today()}`, content: `🔔 My Money reminder\n👤 ${entry.person || 'Someone'} owes ${money(entry.amount)} for ${entry.title}.\n📅 Due: ${longDate(entry.due_date!)}` })),
    ...monthlyReminders.map(({ person, balance, key }) => ({ key, content: `💰 My Money monthly reminder\n👤 ${person} still owes ${money(balance)}.\n🙏 Please settle when you can.` })),
  ]
  for (const message of messages) {
    if (localStorage.getItem(message.key)) continue
    try { await sendDiscordMessage(message.content); localStorage.setItem(message.key, 'sent') } catch { }
  }
}
async function signOut() {
  await supabase?.auth.signOut()
  currentUser = null
  entries = []
  goals = []
  people = []
  activeView = 'overview'
  selectedPersonId = ''
  render()
}

function render() {
  document.documentElement.dataset.theme = currentTheme()
  if (loading) document.querySelector<HTMLDivElement>('#app')!.innerHTML = '<div class="loading-screen">Opening My Money...</div>'
  else if (!currentUser) renderAuth()
  else if (dataError) document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="loading-screen setup-error"><h2>Database setup needed</h2><p>${esc(dataError)}</p><span>Run supabase/setup.sql in your Supabase SQL Editor, then refresh this page.</span></main>`
  else renderApp()
}

function renderAuth() {
  const body = configured ? `<form id="auth-form">${authMode === 'sign-up' ? '<label>Full name<input name="fullName" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" required minlength="6" placeholder="At least 6 characters"></label><button class="primary-btn wide" type="submit">${authMode === 'sign-in' ? 'Sign in' : 'Create account'} <span>→</span></button></form><button class="switch-auth" id="switch-auth">${authMode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>` : '<div class="setup-card"><b>Connect your Supabase workspace</b><span>Add the public project URL and publishable key to .env, then restart the app. No demo accounts or local financial storage are used.</span></div>'
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="auth-page"><div class="auth-art"><div class="brand"><span class="brand-mark">MM</span><span>my money</span></div><div class="art-copy"><p class="eyebrow">YOUR MONEY, CLEARER</p><h1>Know your money. Own your next move.</h1><p>See where your money went, what is coming back, and what you are planning next.</p></div><div class="art-note">Private by default · Built for real life</div></div><section class="auth-panel"><button class="theme-toggle floating-theme" id="theme-toggle" title="Toggle theme">${currentTheme() === 'dark' ? '☀' : '☾'}</button><div class="auth-form"><p class="eyebrow">${configured ? 'WELCOME BACK' : 'SETUP REQUIRED'}</p><h2>${configured ? (authMode === 'sign-in' ? 'Sign in to My Money' : 'Create your account') : 'Connect your workspace'}</h2><p class="auth-subtitle">${configured ? 'Your records follow you across devices.' : 'Your database connection is not complete yet.'}</p>${authError ? `<div class="error-message">${esc(authError)}</div>` : ''}${body}</div><p class="auth-foot">Protected with Supabase Auth and row-level security.</p></section></main>`
  document.querySelector<HTMLButtonElement>('#theme-toggle')!.onclick = toggleTheme
  document.querySelector<HTMLButtonElement>('#switch-auth')?.addEventListener('click', () => { authMode = authMode === 'sign-in' ? 'sign-up' : 'sign-in'; authError = ''; render() })
  document.querySelector<HTMLFormElement>('#auth-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); loading = true; authError = ''; render(); try { const email = String(form.get('email')); const password = String(form.get('password')); const result = authMode === 'sign-in' ? await supabase!.auth.signInWithPassword({ email, password }) : await supabase!.auth.signUp({ email, password, options: { data: { full_name: String(form.get('fullName')) } } }); if (result.error) throw result.error; if (result.data.user) await loadProfile(result.data.user) } catch (error) { authError = error instanceof Error ? error.message : 'Unable to authenticate.' } loading = false; render() })
}

function shell(page: string, heading: string) {
  const admin = currentUser!.role === 'admin' ? '<button class="nav-item" data-view="admin"><span>⌘</span> Admin</button>' : ''
  const nav = `<button class="nav-item ${activeView === 'overview' ? 'active' : ''}" data-view="overview"><span>⌂</span> Overview</button><button class="nav-item ${activeView === 'activity' ? 'active' : ''}" data-view="activity"><span>☷</span> Activity</button><button class="nav-item ${activeView === 'people' ? 'active' : ''}" data-view="people"><span>♙</span> People</button><button class="nav-item ${activeView === 'calendar' ? 'active' : ''}" data-view="calendar"><span>▣</span> Calendar</button><button class="nav-item ${activeView === 'notifications' ? 'active' : ''}" data-view="notifications"><span>♢</span> Notifications</button>${admin}`
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<aside class="sidebar"><div class="brand"><span class="brand-mark">MM</span><span>my money</span></div><nav>${nav}</nav><div class="sidebar-account"><div class="avatar">${initials(currentUser!.full_name)}</div><div><b>${esc(currentUser!.full_name)}</b><span>${currentUser!.role}</span><button class="profile-edit" id="edit-profile">Edit profile</button></div></div><div class="sidebar-foot"><span class="status-dot"></span><span>Synced securely</span></div></aside><main class="main-content"><header class="topbar"><div><p class="eyebrow">${currentUser!.role === 'admin' ? 'ADMIN WORKSPACE' : 'PERSONAL FINANCE'}</p><h1>${heading}</h1></div><div class="top-actions"><button class="theme-toggle" id="theme-toggle" title="Toggle theme">${currentTheme() === 'dark' ? '☀' : '☾'}</button><button class="secondary-btn" id="sign-out">Sign out</button>${activeView === 'overview' || activeView === 'activity' || activeView === 'people' ? '<button class="primary-btn" data-open-entry><span>＋</span> Add entry</button>' : ''}</div></header>${page}${toastMessage ? `<div class="toast" role="status">${esc(toastMessage)}</div>` : ''}${modalMarkup()}${personModalMarkup()}${profileMarkup()}</main>`
  bindShell()
}

function renderApp(): void {
  if (activeView === 'calendar') return shell(renderCalendar(), 'Calendar')
  if (activeView === 'notifications') return shell(renderNotifications(), 'Notifications')
  if (activeView === 'person-detail') return shell(renderPersonDetail(), 'Person statement')
    if (activeView === 'admin') return shell(renderAdmin() + adminToolsMarkup(), 'Admin')
  const spent = entries.filter((entry) => entry.status === 'spent').reduce((sum, entry) => sum + entry.amount, 0)
  const lent = entries.filter((entry) => entry.status === 'lent').reduce((sum, entry) => sum + entry.amount, 0)
  const repaid = entries.filter((entry) => entry.status === 'repaid').reduce((sum, entry) => sum + entry.amount, 0)
  const knownPeople = [...people]
  if (activeView === 'activity') return shell(`<section class="panel full-panel"><div class="panel-head"><div><h2>All activity</h2><p>Every payment, expense, and repayment</p></div><div class="filter-row">${['All activity', 'Spent', 'Lent out', 'Repaid'].map((filter) => `<button class="filter ${activeFilter === filter ? 'selected' : ''}" data-filter="${filter}">${filter}</button>`).join('')}</div></div>${renderEntries()}</section>`, 'Activity')
  if (activeView === 'people') return shell(`<section class="panel full-panel"><div class="panel-head"><div><h2>People</h2><p>Your trusted circle and money they owe you</p></div><button class="primary-btn" id="open-person"><span>＋</span> Add person</button></div><div class="people-directory">${renderPeople(knownPeople, true)}</div></section>`, 'People')
  shell(`<section class="stats-grid"><div class="stat-card featured"><div class="stat-label">Total cash out <span class="trend">Live</span></div><strong>${money(spent + lent)}</strong><p>Across ${entries.length} records</p><div class="sparkline"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="stat-card"><div class="stat-label">Out to friends <span class="stat-icon">↗</span></div><strong>${money(lent)}</strong><p>${knownPeople.length} people to follow up</p></div><div class="stat-card"><div class="stat-label">Repaid <span class="stat-icon green">✓</span></div><strong>${money(repaid)}</strong><p class="green-text">${entries.filter((entry) => entry.status === 'repaid').length} settled payments</p></div></section><section class="content-grid"><div class="panel activity-panel"><div class="panel-head"><div><h2>Recent activity</h2><p>Where your money went</p></div><button class="text-btn" data-view="activity">View all <span>→</span></button></div>${renderEntries(5)}</div><div class="panel people-panel"><div class="panel-head"><div><h2>People</h2><p>Who owes you</p></div></div>${renderPeople(knownPeople)}</div></section><section class="panel goals-panel"><div class="panel-head"><div><h2>Goals</h2><p>Optional plans for future spending</p></div><button class="secondary-btn" id="open-goal">＋ Add goal</button></div>${renderGoals()}</section>`, `Hello, ${esc(currentUser!.full_name.split(' ')[0])}.`)
}

function renderEntries(limit?: number) { const filtered = entries.filter((entry) => activeFilter === 'All activity' || entry.status === activeFilter.toLowerCase().replace(' ', '') || (activeFilter === 'Lent out' && entry.status === 'lent')).slice(0, limit); if (!filtered.length) return '<div class="empty">Nothing here yet. Add your first entry to get started.</div>'; return `<div class="entry-list">${filtered.map((entry) => `<div class="entry"><div class="entry-icon ${entry.category.toLowerCase()}">${entry.category === 'Food' ? '⌁' : entry.category === 'Travel' ? '↗' : entry.category === 'Fun' ? '✦' : '⌂'}</div><div class="entry-main"><strong>${esc(entry.title)}</strong><span>${longDate(entry.date)} · ${esc(entry.category)}${entry.person ? ` · <b>${esc(entry.person)}</b>` : ''}${entry.due_date ? ` · Due ${shortDate(entry.due_date)}` : ''}</span></div><div class="entry-amount"><strong>${money(entry.amount)}</strong><span class="pill ${entry.status}">${entry.status === 'lent' ? 'Lent out' : entry.status === 'repaid' ? 'Repaid' : 'Spent'}</span></div><button class="edit-btn" data-edit-entry="${entry.id}" title="Edit entry">✎</button><button class="delete-btn" data-delete="${entry.id}" title="Delete entry">×</button></div>`).join('')}</div>` }
function renderPeople(directoryPeople: Person[], directory = false) { if (!directoryPeople.length) return '<div class="empty people-empty"><strong>No people yet</strong><span>Add someone once, then select them whenever you lend or record a repayment.</span><button class="primary-btn" id="open-person-empty"><span>＋</span> Add your first person</button></div>'; return directoryPeople.map((person, index) => { const owed = entries.filter((entry) => entry.person === person.name && entry.status === 'lent').reduce((sum, entry) => sum + entry.amount, 0); const settled = entries.filter((entry) => entry.person === person.name && entry.status === 'repaid').reduce((sum, entry) => sum + entry.amount, 0); return `<div class="person-row ${directory ? 'directory-row' : ''}" data-person-id="${person.id}" role="button" tabindex="0"><div class="avatar avatar-${index % 4}">${initials(person.name)}</div><div class="person-main"><strong>${esc(person.name)}</strong><span>${esc(person.email || person.phone || 'No contact details')}</span></div><div class="person-balance ${owed ? '' : 'settled'}"><strong>${money(owed || settled)}</strong><span>${owed ? 'owes you' : settled ? 'settled' : 'no balance'}</span></div><button class="text-btn person-entry" data-person-entry="${esc(person.name)}">Add entry</button><button class="edit-btn person-edit" data-edit-person="${person.id}" title="Edit person">✎</button></div>` }).join('') }
function renderPersonDetail(): string { const person = people.find((item) => item.id === selectedPersonId); if (!person) return '<section class="panel full-panel"><div class="empty">Person not found. Return to People and choose a contact again.</div></section>'; const personEntries = entries.filter((entry) => entry.person === person.name).sort((first, second) => second.date.localeCompare(first.date)); const lent = personEntries.filter((entry) => entry.status === 'lent').reduce((sum, entry) => sum + entry.amount, 0); const repaid = personEntries.filter((entry) => entry.status === 'repaid').reduce((sum, entry) => sum + entry.amount, 0); const balance = lent - repaid; return `<section class="statement-page"><div class="statement-actions"><button class="text-btn" id="back-to-people">← Back to people</button><div><button class="secondary-btn" id="share-person">WhatsApp <span>↗</span></button><button class="secondary-btn" id="share-person-discord">Discord <span>↗</span></button><button class="primary-btn" id="print-person"><span>↓</span> Save as PDF</button></div></div><section class="panel statement-card"><div class="statement-header"><div class="avatar avatar-large">${initials(person.name)}</div><div class="statement-person"><p class="eyebrow">PAYMENT STATEMENT</p><div class="statement-person-name"><h2>${esc(person.name)}</h2><button class="secondary-btn edit-person-profile" data-edit-person="${person.id}" title="Edit person profile">Edit profile <span>✎</span></button></div><p>${esc(person.email || person.phone || 'No contact details')}</p></div><span class="statement-status ${balance > 0 ? 'due' : 'settled'}">${balance > 0 ? 'Balance due' : 'Settled'}</span></div><div class="statement-summary"><div><span>Total lent</span><strong>${money(lent)}</strong></div><div><span>Repaid</span><strong>${money(repaid)}</strong></div><div class="statement-balance"><span>Balance</span><strong>${money(Math.max(0, balance))}</strong></div></div><div class="statement-list"><div class="statement-list-head"><span>Date</span><span>Description</span><span>Note</span><span>Amount</span><span></span></div>${personEntries.length ? personEntries.map((entry) => `<div class="statement-line"><span>${longDate(entry.date)}</span><strong>${esc(entry.title)}</strong><span>${esc(entry.note || 'No remark')}</span><b class="${entry.status}">${entry.status === 'repaid' ? '-' : '+'}${money(entry.amount)}</b><button class="edit-btn" data-edit-entry="${entry.id}" title="Edit entry">✎</button></div>`).join('') : '<div class="empty">No payment records for this person yet.</div>'}</div><p class="statement-footer">Prepared by ${esc(currentUser!.full_name)} · ${longDate(today())}</p></section></section>` }
function renderGoals() { if (!goals.length) return '<div class="empty goal-empty">Goals are optional. Add one when you want structure around a plan.</div>'; return `<div class="goal-list">${goals.map((goal) => { const progress = Math.min(100, Math.round((goal.saved_amount / goal.target_amount) * 100)); return `<div class="goal-row"><div class="goal-mark">${progress >= 100 ? '✓' : '◌'}</div><div class="goal-main"><strong>${esc(goal.title)}</strong><span>${money(goal.saved_amount)} saved of ${money(goal.target_amount)}${goal.deadline ? ` · by ${shortDate(goal.deadline)}` : ''}</span><div class="progress-track"><i style="width:${progress}%"></i></div></div><b class="goal-percent">${progress}%</b></div>` }).join('')}</div>` }
function renderCalendar() { const month = new Date(); const year = month.getFullYear(); const monthIndex = month.getMonth(); const firstDay = new Date(year, monthIndex, 1).getDay(); const days = new Date(year, monthIndex + 1, 0).getDate(); const cells = Array.from({ length: firstDay + days }, (_, index) => { const day = index - firstDay + 1; if (day < 1) return '<div class="calendar-day blank"></div>'; const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const events = entries.filter((entry) => entry.date === date || entry.due_date === date); return `<div class="calendar-day"><b>${day}</b>${events.map((entry) => `<span class="calendar-event ${entry.status}" title="${esc(entry.title)}">${entry.status === 'lent' && entry.due_date === date ? 'Due · ' : ''}${esc(entry.person || entry.title)}</span>`).join('')}</div>` }).join(''); return `<section class="panel calendar-panel"><div class="calendar-head"><div><p class="eyebrow">MONEY MOVEMENT</p><h2>${month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2></div><div class="calendar-legend"><span><i class="spent-dot"></i>Spent</span><span><i class="lent-dot"></i>Lent</span><span><i class="repaid-dot"></i>Repaid</span></div></div><div class="calendar-week">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<b>${day}</b>`).join('')}</div><div class="calendar-grid">${cells}</div></section>` }
function renderNotifications() { return `<section class="panel settings-panel"><div class="panel-head"><div><h2>Notifications</h2><p>Get a reminder before money is due back</p></div><span class="settings-badge">MONTHLY DEFAULT</span></div><form id="notification-form" class="settings-form">${notificationMessage ? `<p class="settings-note">${esc(notificationMessage)}</p>` : ''}<label class="toggle-row"><span><b>Repayment reminders</b><small>Send a monthly reminder while someone still owes you, plus due-date reminders.</small></span><input type="checkbox" name="enabled" ${settings.reminders_enabled ? 'checked' : ''}><i></i></label><label class="webhook-label">Discord webhook URL<div class="webhook-control"><span class="webhook-mark">◆</span><input name="webhook" type="url" value="${esc(settings.discord_webhook_url)}" placeholder="https://discord.com/api/webhooks/..."></div><small>Keep this webhook private. It is stored with your account settings.</small></label><label>Due-date reminder <select name="days"><option value="0" ${settings.reminder_days_before === 0 ? 'selected' : ''}>On the due date</option><option value="1" ${settings.reminder_days_before === 1 ? 'selected' : ''}>1 day before</option><option value="3" ${settings.reminder_days_before === 3 ? 'selected' : ''}>3 days before</option><option value="7" ${settings.reminder_days_before === 7 ? 'selected' : ''}>1 week before</option></select></label><div class="settings-actions"><button class="secondary-btn" id="test-discord" type="button">Test Discord <span>↗</span></button><button class="primary-btn" type="submit">Save notification settings <span>→</span></button></div><p class="settings-note">Add a person and record repayments to receive one monthly reminder for each outstanding balance. My Money checks when you open the app; a scheduled Supabase function is needed when it is closed.</p></form></section>` }
function renderAdmin() { return `<section class="panel admin-panel"><div class="panel-head"><div><h2>Workspace administration</h2><p>Invite people, control roles, and remove access</p></div><span class="role-badge">ADMIN</span></div>${adminMessage ? `<div class="admin-message">${esc(adminMessage)}</div>` : ''}<form class="invite-form" id="invite-form"><input name="fullName" required placeholder="Full name"><input name="email" type="email" required placeholder="Email address"><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select><button class="primary-btn" type="submit">Invite user <span>→</span></button></form><div class="user-table"><div class="user-table-head"><span>Person</span><span>Role</span><span>Joined</span><span>Action</span></div>${adminUsers.length ? adminUsers.map((user) => `<div class="user-row"><div class="user-cell person-cell"><div class="avatar">${initials(user.full_name)}</div><div><b>${esc(user.full_name)}</b><small>${esc(user.email)}</small></div></div><div><select class="role-select" data-role-user="${user.id}" ${user.id === currentUser!.id ? 'disabled' : ''}><option value="member" ${user.role === 'member' ? 'selected' : ''}>Member</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option></select></div><small>${longDate(user.created_at.slice(0, 10))}</small><div>${user.id === currentUser!.id ? '<span class="you-label">You</span>' : `<button class="danger-btn" data-remove-user="${user.id}" data-user-name="${esc(user.full_name)}">Remove</button>`}</div></div>`).join('') : '<div class="empty">No users found.</div>'}</div><div class="admin-grid"><div class="admin-card"><span class="stat-icon">♧</span><strong>Role-based access</strong><p>Members manage their own ledger. Admins manage the workspace.</p></div><div class="admin-card"><span class="stat-icon green">✓</span><strong>Data protection</strong><p>Account actions run through a protected Supabase Edge Function.</p></div></div></section>` }

function adminToolsMarkup() { return `<section class="panel admin-tools"><div class="panel-head"><div><h2>Account actions</h2><p>Changes are checked and executed on the server.</p></div></div><form id="admin-profile-form" class="admin-action-form"><label>User<select name="userId" required>${adminUsers.map((user) => `<option value="${user.id}">${esc(user.full_name)} · ${esc(user.email)}</option>`).join('')}</select></label><label>Username<input name="fullName" required placeholder="New display name"></label><button class="secondary-btn" type="submit">Save username</button></form><form id="admin-reset-form" class="admin-action-form"><label>User<select name="userId" required>${adminUsers.map((user) => `<option value="${user.id}">${esc(user.full_name)} · ${esc(user.email)}</option>`).join('')}</select></label><button class="primary-btn" type="submit">Send password change email <span>→</span></button></form></section>` }

function bindShell() {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((element) => element.onclick = () => { activeView = element.dataset.view || 'overview'; render() })
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((element) => element.onclick = () => { activeFilter = element.dataset.filter || 'All activity'; render() })
  document.querySelectorAll<HTMLButtonElement>('[data-edit-entry]').forEach((button) => button.onclick = () => openEntryModal('', button.dataset.editEntry || ''))
  document.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) => button.onclick = async () => { await deleteEntry(button.dataset.delete || ''); render() })
  document.querySelector<HTMLButtonElement>('#theme-toggle')!.onclick = toggleTheme
  document.querySelector<HTMLButtonElement>('#sign-out')!.onclick = signOut
  document.querySelectorAll<HTMLButtonElement>('[data-open-entry]').forEach((button) => button.addEventListener('click', () => openEntryModal()))
  document.querySelector<HTMLButtonElement>('#open-person')?.addEventListener('click', () => openPersonModal())
  document.querySelector<HTMLButtonElement>('#open-person-empty')?.addEventListener('click', () => openPersonModal())
  document.querySelectorAll<HTMLButtonElement>('[data-edit-person]').forEach((button) => button.onclick = (event) => { event.stopPropagation(); openPersonModal(button.dataset.editPerson || '') })
  document.querySelectorAll<HTMLButtonElement>('[data-person-entry]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); openEntryModal(button.dataset.personEntry) }))
  document.querySelectorAll<HTMLElement>('[data-person-id]').forEach((element) => element.addEventListener('click', () => { selectedPersonId = element.dataset.personId || ''; activeView = 'person-detail'; render() }))
  document.querySelector<HTMLButtonElement>('#back-to-people')?.addEventListener('click', () => { activeView = 'people'; render() })
  document.querySelector<HTMLButtonElement>('#print-person')?.addEventListener('click', () => window.print())
  document.querySelector<HTMLButtonElement>('#share-person')?.addEventListener('click', sharePerson)
  document.querySelector<HTMLButtonElement>('#share-person-discord')?.addEventListener('click', sharePersonOnDiscord)
  document.querySelector<HTMLButtonElement>('#open-goal')?.addEventListener('click', openGoalModal)
  document.querySelector<HTMLButtonElement>('#edit-profile')?.addEventListener('click', () => document.querySelector<HTMLDivElement>('#profile-modal')?.classList.remove('hidden'))
  bindModalForms()
  const categorySelect = document.querySelector<HTMLSelectElement>('select[name="category"]')
  ;['Transport', 'Electronics', 'Shopping', 'Going out', 'Health', 'Bills', 'Education'].forEach((category) => categorySelect?.add(new Option(category)))
  document.querySelector<HTMLFormElement>('#profile-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); profileMessage = ''; try { await saveProfile(String(form.get('fullName'))); } catch (error) { profileMessage = error instanceof Error ? error.message : 'Unable to update profile.' } render() })
  document.querySelector<HTMLFormElement>('#person-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const name = String(form.get('name')).trim(); entryMessage = ''; const duplicate = people.some((person) => person.id !== editingPersonId && person.name.toLowerCase() === name.toLowerCase()); if (duplicate) { entryMessage = 'That person is already in your directory.'; render(); document.querySelector<HTMLDivElement>('#person-modal')?.classList.remove('hidden'); return } try { const person = { name, email: String(form.get('email')).trim(), phone: String(form.get('phone')).trim() }; if (editingPersonId) await updatePerson(editingPersonId, person); else await savePerson(person); editingPersonId = ''; document.querySelector<HTMLDivElement>('#person-modal')?.classList.add('hidden'); render() } catch (error) { entryMessage = errorText(error, 'Unable to save this person.'); render(); document.querySelector<HTMLDivElement>('#person-modal')?.classList.remove('hidden') } })
  document.querySelector<HTMLButtonElement>('#test-discord')?.addEventListener('click', async () => { notificationMessage = ''; const form = document.querySelector<HTMLFormElement>('#notification-form'); const webhook = String(new FormData(form || undefined).get('webhook') || ''); try { await sendDiscordMessage('My Money test: Discord notifications are working.', webhook); notificationMessage = 'Test message sent to Discord.' } catch (error) { notificationMessage = errorText(error, 'Unable to send the test message.') } render() })
  document.querySelector<HTMLFormElement>('#notification-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); notificationMessage = ''; settings = { discord_webhook_url: String(form.get('webhook')), reminders_enabled: form.get('enabled') === 'on', reminder_days_before: Number(form.get('days')) }; await saveSettings(); notificationMessage = 'Notification settings saved.'; render() })
  document.querySelector<HTMLFormElement>('#invite-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); adminMessage = ''; try { await adminAction('invite', { email: String(form.get('email')), full_name: String(form.get('fullName')), role: String(form.get('role')) }); adminMessage = 'Invitation sent successfully.' } catch (error) { adminMessage = error instanceof Error ? error.message : 'Unable to invite this user.' } render() })
  document.querySelector<HTMLFormElement>('#admin-profile-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); adminMessage = ''; try { await adminAction('update-profile', { user_id: String(form.get('userId')), full_name: String(form.get('fullName')) }); adminMessage = 'Username updated.' } catch (error) { adminMessage = errorText(error, 'Unable to update this username.') } render() })
  document.querySelector<HTMLFormElement>('#admin-reset-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); adminMessage = ''; try { await adminAction('reset-password', { user_id: String(form.get('userId')) }); adminMessage = 'Password change email sent.' } catch (error) { adminMessage = errorText(error, 'Unable to send the password change email.') } render() })
  document.querySelectorAll<HTMLSelectElement>('[data-role-user]').forEach((select) => select.onchange = async () => { adminMessage = ''; try { await adminAction('role', { user_id: select.dataset.roleUser, role: select.value }); adminMessage = 'User role updated.' } catch (error) { adminMessage = error instanceof Error ? error.message : 'Unable to update this role.' } render() })
  document.querySelectorAll<HTMLButtonElement>('[data-remove-user]').forEach((button) => button.onclick = async () => { if (!window.confirm(`Remove ${button.dataset.userName || 'this user'}? Their account and ledger data will be deleted.`)) return; adminMessage = ''; try { await adminAction('delete', { user_id: button.dataset.removeUser }); adminMessage = 'User removed.' } catch (error) { adminMessage = error instanceof Error ? error.message : 'Unable to remove this user.' } render() })
}
function bindModalForms() {
  const entryForm = document.querySelector<HTMLFormElement>('#entry-form')
  entryForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    entryMessage = ''
    const modal = document.querySelector<HTMLDivElement>('#entry-modal')
    const submit = entryForm.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (submit) { submit.disabled = true; submit.textContent = 'Saving...' }
    try {
      const dueDate = String(form.get('dueDate') || '').trim()
      const entry = { title: String(form.get('title')).trim(), amount: Number(form.get('amount')), date: String(form.get('date')), due_date: dueDate || null, category: String(form.get('category')), person: String(form.get('person')).trim(), note: String(form.get('note')).trim(), status: form.get('status') as Status }
      if (editingEntryId) await updateEntry(editingEntryId, entry)
      else await saveEntry(entry)
      editingEntryId = ''
      modal?.classList.add('hidden')
      render()
    } catch (error) {
      entryMessage = errorText(error, 'Unable to save this entry.')
      render()
      document.querySelector<HTMLDivElement>('#entry-modal')?.classList.remove('hidden')
    }
  })
  document.querySelector<HTMLButtonElement>('#clear-due-date')?.addEventListener('click', () => { const dueDate = document.querySelector<HTMLInputElement>('#due-date'); if (dueDate) dueDate.value = '' })
  document.querySelector<HTMLFormElement>('#goal-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); await saveGoal({ title: String(form.get('title')), target_amount: Number(form.get('target')), saved_amount: Number(form.get('saved')), deadline: String(form.get('deadline')), color: 'olive' }); render() })
  document.querySelectorAll<HTMLElement>('[data-close-modal]').forEach((button) => button.onclick = () => button.closest('.modal')?.classList.add('hidden'))
}
function openEntryModal(personName = '', entryId = '') { editingEntryId = entryId; const modal = document.querySelector<HTMLDivElement>('#entry-modal'); const entry = entries.find((item) => item.id === entryId); modal?.classList.remove('hidden'); const title = modal?.querySelector<HTMLElement>('#entry-modal-title'); if (title) title.textContent = entry ? 'Edit money movement' : 'Add money movement'; const submit = modal?.querySelector<HTMLButtonElement>('#entry-submit'); if (submit) submit.innerHTML = entry ? 'Update entry <span>→</span>' : 'Save entry <span>→</span>'; const fields = { title: entry?.title || '', amount: entry ? String(entry.amount) : '', date: entry?.date || today(), category: entry?.category || 'Food', status: entry?.status || 'spent', dueDate: entry?.due_date || '', person: entry?.person || personName, note: entry?.note || '' }; Object.entries(fields).forEach(([name, value]) => { const field = modal?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`); if (field) field.value = value }) }
function openPersonModal(personId = '') { editingPersonId = personId; entryMessage = ''; const modal = document.querySelector<HTMLDivElement>('#person-modal'); const person = people.find((item) => item.id === personId); modal?.classList.remove('hidden'); const title = modal?.querySelector<HTMLElement>('#person-modal-title'); if (title) title.textContent = person ? 'Edit person' : 'Add a person'; const submit = modal?.querySelector<HTMLButtonElement>('#person-submit'); if (submit) submit.innerHTML = person ? 'Update person <span>→</span>' : 'Save person <span>→</span>'; const name = modal?.querySelector<HTMLInputElement>('input[name="name"]'); const email = modal?.querySelector<HTMLInputElement>('input[name="email"]'); const phone = modal?.querySelector<HTMLInputElement>('input[name="phone"]'); if (name) name.value = person?.name || ''; if (email) email.value = person?.email || ''; if (phone) phone.value = person?.phone || '' }
function personStatementMessage() { const person = people.find((item) => item.id === selectedPersonId); if (!person) return null; const personEntries = entries.filter((entry) => entry.person === person.name).sort((first, second) => second.date.localeCompare(first.date)); const lent = personEntries.filter((entry) => entry.status === 'lent').reduce((sum, entry) => sum + entry.amount, 0); const repaid = personEntries.filter((entry) => entry.status === 'repaid').reduce((sum, entry) => sum + entry.amount, 0); const lines = personEntries.map((entry) => `${longDate(entry.date)} | ${entry.title} | ${entry.status === 'repaid' ? '-' : '+'}${money(entry.amount)}${entry.note ? ` | ${entry.note}` : ''}`); return `Payment statement for ${person.name}\n\nTotal lent: ${money(lent)}\nRepaid: ${money(repaid)}\nBalance due: ${money(Math.max(0, lent - repaid))}\n\n${lines.join('\n')}\n\nPrepared by ${currentUser!.full_name}` }
function decorateStatementMessage(message: string) { return `💰 MY MONEY PAYMENT STATEMENT\n━━━━━━━━━━━━━━━━\n${message.replace('Payment statement for', '👤 Payment statement for').replace('Total lent:', '📤 Total lent:').replace('Repaid:', '✅ Repaid:').replace('Balance due:', '🔔 Balance due:')}\n\n🙏 Please settle the balance when you can.` }
function sharePerson() { const message = personStatementMessage(); if (message) window.open(`https://wa.me/?text=${encodeURIComponent(decorateStatementMessage(message))}`, '_blank', 'noopener') }
async function sharePersonOnDiscord() { const message = personStatementMessage(); if (!message) return; try { await sendDiscordMessage(decorateStatementMessage(message)); window.alert('Statement sent to Discord.') } catch (error) { window.alert(errorText(error, 'Unable to send the statement to Discord.')) } }
function openGoalModal() { document.querySelector<HTMLDivElement>('#goal-modal')?.classList.remove('hidden') }
function personModalMarkup() { return `<div class="modal hidden" id="person-modal"><form class="modal-card" id="person-form"><div class="modal-head"><div><p class="eyebrow">PEOPLE DIRECTORY</p><h2 id="person-modal-title">Add a person</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><p class="modal-intro">Keep your circle ready for the next payment.</p><label>Name<input name="name" required maxlength="80" placeholder="e.g. Aisha Khan"></label><label>Email <span class="optional">optional</span><input name="email" type="email" placeholder="aisha@example.com"></label><label>Phone <span class="optional">optional</span><input name="phone" type="tel" placeholder="+91 98765 43210"></label><button class="primary-btn wide" id="person-submit" type="submit">Save person <span>→</span></button></form></div>` }
function modalMarkup() { return `<div class="modal hidden" id="entry-modal"><form class="modal-card" id="entry-form"><div class="modal-head"><div><p class="eyebrow">MONEY RECORD</p><h2 id="entry-modal-title">Add money movement</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div>${entryMessage ? `<div class="error-message">${esc(entryMessage)}</div>` : ''}<label>What was it for?<input name="title" required placeholder="e.g. Groceries, hotel deposit"></label><div class="form-row"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label><label>Date<input name="date" type="date" required value="${today()}"></label></div><div class="form-row"><label>Category<select name="category"><option>Food</option><option>Travel</option><option>Home</option><option>Fun</option><option>Other</option></select></label><label>Type<select name="status"><option value="spent">I paid</option><option value="lent">I lent it</option><option value="repaid">Repaid to me</option></select></label></div><label>Due date <span class="optional">optional · useful for lent money</span><div class="date-control"><input id="due-date" name="dueDate" type="date"><button type="button" class="clear-date" id="clear-due-date">Clear date</button></div></label><label>Person <span class="optional">optional</span><input name="person" placeholder="Who was involved?"></label><label>Note <span class="optional">optional</span><textarea name="note" rows="2" placeholder="Add a useful detail"></textarea></label><button class="primary-btn wide" id="entry-submit" type="submit">Save entry <span>→</span></button></form></div><div class="modal hidden" id="goal-modal"><form class="modal-card" id="goal-form"><div class="modal-head"><div><p class="eyebrow">OPTIONAL PLAN</p><h2>Add a goal</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><label>What are you planning for?<input name="title" required placeholder="e.g. Holiday, new laptop"></label><div class="form-row"><label>Target amount<input name="target" type="number" min="1" step="0.01" required placeholder="0.00"></label><label>Already saved<input name="saved" type="number" min="0" step="0.01" value="0"></label></div><label>Target date<input name="deadline" type="date"></label><button class="primary-btn wide" type="submit">Save goal <span>→</span></button></form></div>` }
function profileMarkup() { return `<div class="modal hidden" id="profile-modal"><form class="modal-card" id="profile-form"><div class="modal-head"><div><p class="eyebrow">YOUR ACCOUNT</p><h2>Edit profile</h2></div><button type="button" class="close-btn" data-close-modal>×</button></div><label>Display name<input name="fullName" required value="${esc(currentUser!.full_name)}" placeholder="Your name"></label><label>Email address<input value="${esc(currentUser!.email)}" disabled></label>${profileMessage ? `<p class="settings-note">${esc(profileMessage)}</p>` : ''}<button class="primary-btn wide" type="submit">Save profile <span>→</span></button></form></div>` }
function toggleTheme() { localStorage.setItem('my-money-theme', currentTheme() === 'dark' ? 'light' : 'dark'); render() }

const originalRenderApp = renderApp
const appRender = renderApp
void originalRenderApp
void appRender
loadSession()
