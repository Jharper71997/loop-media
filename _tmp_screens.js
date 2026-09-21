
const { createClient } = require('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
;(async()=>{
  const { data: tvs, error } = await s.from('tvs').select("*")
  if(error) return console.error('tvs',error.message)
  const { data: venues } = await s.from('venues').select('id,name,status,city')
  const vm = Object.fromEntries((venues||[]).map(v=>[v.id,v]))
  console.log('TOTAL tvs:', tvs.length)
  const by = {}
  tvs.forEach(t=>{ by[t.status]=(by[t.status]||0)+1 })
  console.log('by status:', by)
  tvs.forEach(t=>{
    const v = vm[t.venue_id]||{}
    console.log([t.status, v.status, v.name, t.last_seen_at].join(' | '))
  })
  const { data: subs } = await s.from('subscriptions').select('id,status,advertiser_id,screens,amount_cents,created_at').limit(50)
  console.log('\nSUBS:', JSON.stringify(subs,null,1))
})()
