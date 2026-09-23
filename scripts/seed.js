const path = require('path');
const fs = require('fs');
const db = require('../server/db');
const { hashPassword, uuid } = require('../server/auth');

const RESET = process.argv.includes('--reset');

if (RESET) {
  // Wipe tables
  db.db.exec(`
    DELETE FROM payments;
    DELETE FROM bookings;
    DELETE FROM users;
    DELETE FROM mechanics;
  `);
  console.log('Database tables cleared.');
}

const mechanics = [
  { id: 'mech-marcus', name: 'Marcus Hale', initials: 'MH', rating: 4.9, reviews: 127, years: 12,
    specialties: ['Domestic', 'OBD diagnostics', 'Negotiation support'],
    bio: 'Former dealership tech. Great at spotting flood and accident history tells.',
    area: 'Bay Area', active: true },
  { id: 'mech-priya', name: 'Priya Shah', initials: 'PS', rating: 4.95, reviews: 89, years: 9,
    specialties: ['European', 'Hybrid/EV', 'Detailed reports'],
    bio: 'Specializes in German and hybrid vehicles. Clear, calm communication.',
    area: 'East Bay', active: true },
  { id: 'mech-jamal', name: 'Jamal Ortiz', initials: 'JO', rating: 4.85, reviews: 203, years: 15,
    specialties: ['Trucks & SUVs', 'Undercarriage', 'Private-party buys'],
    bio: 'Loves private-party deals. Will crawl under anything and tell it like it is.',
    area: 'South Bay', active: true },
  { id: 'mech-elena', name: 'Elena Voss', initials: 'EV', rating: 4.9, reviews: 64, years: 7,
    specialties: ['Japanese', 'Pre-purchase', 'First-time buyers'],
    bio: 'Patient with first-time buyers. Excellent at explaining issues without scare tactics.',
    area: 'Peninsula', active: true },
];

for (const m of mechanics) db.upsertMechanic(m);

if (db.countUsers() === 0 || RESET) {
  const users = [
    { id: uuid(), email: 'buyer@demo.com', passwordHash: hashPassword('demo1234'), name: 'Alex Buyer',
      role: 'buyer', phone: '555-0100', mechanicId: null, active: true, createdAt: new Date().toISOString() },
    { id: uuid(), email: 'marcus@demo.com', passwordHash: hashPassword('demo1234'), name: 'Marcus Hale',
      role: 'mechanic', phone: '555-0101', mechanicId: 'mech-marcus', active: true, createdAt: new Date().toISOString() },
    { id: uuid(), email: 'priya@demo.com', passwordHash: hashPassword('demo1234'), name: 'Priya Shah',
      role: 'mechanic', phone: '555-0102', mechanicId: 'mech-priya', active: true, createdAt: new Date().toISOString() },
  ];
  for (const u of users) db.insertUser(u);
}

console.log('Seed complete.');
console.log('  DB file:  ' + db.DB_PATH);
console.log('  Users:    ' + db.countUsers());
console.log('  Mechanics:' + db.countMechanics());
console.log('Demo accounts (password: demo1234):');
console.log('  Buyer:    buyer@demo.com');
console.log('  Mechanic: marcus@demo.com');
console.log('  Mechanic: priya@demo.com');
