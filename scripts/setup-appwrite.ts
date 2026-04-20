import { Client, Databases, ID, Permission, Role, Query } from 'node-appwrite';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'http://localhost/v1')
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '')
    .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const dbId = 'arena';

const seededAgents = [
  { name: 'Lisa', init: 'LI', color: '#F4B400', timeframe: '15m', strategyCards: ['Volume Surge', 'RSI Reversal', 'Momentum Break', 'VWAP Reclaim'] },
  { name: 'Bart', init: 'BA', color: '#FF6D01', timeframe: '15m', strategyCards: ['Momentum Break', 'Volume Surge', 'VWAP Reclaim'] },
  { name: 'Marge', init: 'MA', color: '#4285F4', timeframe: '1h', strategyCards: ['VWAP Reclaim', 'Trend Ride', 'RSI Reversal'] },
  { name: 'Homer', init: 'HO', color: '#34A853', timeframe: '1h', strategyCards: ['RSI Reversal', 'Momentum Break', 'Trend Ride'] },
  { name: 'Mr Burns', init: 'MB', color: '#A142F4', timeframe: '4h', strategyCards: ['Trend Ride', 'RSI Reversal'] },
];

async function setup() {
    try {
        console.log('Updating Appwrite schema...');
        const publicRead = [Permission.read(Role.any())];

        const setupCollection = async (id: string, name: string, attributes: any[]) => {
            try {
                try {
                    await databases.getCollection(dbId, id);
                    await databases.updateCollection(dbId, id, name, publicRead);
                } catch {
                    await databases.createCollection(dbId, id, name, publicRead);
                    for (const attr of attributes) {
                        if (attr.type === 'string') await databases.createStringAttribute(dbId, id, attr.key, attr.size, attr.required, attr.array ?? false);
                        else if (attr.type === 'float') await databases.createFloatAttribute(dbId, id, attr.key, attr.required);
                        else if (attr.type === 'integer') await databases.createIntegerAttribute(dbId, id, attr.key, attr.required);
                        else if (attr.type === 'boolean') await databases.createBooleanAttribute(dbId, id, attr.key, attr.required);
                    }
                }
            } catch (e: any) {
                console.error(`Error on ${name}:`, e.message);
            }
        };

        await setupCollection('agents', 'Agents', [
            { key: 'name', type: 'string', size: 100, required: true },
            { key: 'won', type: 'integer', required: true },
            { key: 'loss', type: 'integer', required: true },
            { key: 'winRate', type: 'float', required: true },
            { key: 'init', type: 'string', size: 10, required: true },
            { key: 'color', type: 'string', size: 20, required: true },
            { key: 'timeframe', type: 'string', size: 10, required: true },
            { key: 'promoted', type: 'boolean', required: true },
            { key: 'strategyCards', type: 'string', size: 100, required: false, array: true },
            { key: 'isActive', type: 'boolean', required: true },
        ]);

        await setupCollection('rounds', 'Rounds', [
            { key: 'roundId', type: 'string', size: 100, required: true },
            { key: 'asset', type: 'string', size: 50, required: true },
            { key: 'timeframe', type: 'string', size: 10, required: true },
            { key: 'startTime', type: 'string', size: 50, required: true },
            { key: 'endTime', type: 'string', size: 50, required: true },
            { key: 'entryPrice', type: 'float', required: false },
            { key: 'exitPrice', type: 'float', required: false },
            { key: 'status', type: 'string', size: 20, required: true },
        ]);

        await setupCollection('trades', 'Trades', [
            { key: 'agentId', type: 'string', size: 255, required: true },
            { key: 'roundId', type: 'string', size: 255, required: true },
            { key: 'strategyName', type: 'string', size: 100, required: true },
            { key: 'signal', type: 'string', size: 20, required: true },
            { key: 'entry', type: 'float', required: false },
            { key: 'exit', type: 'float', required: false },
            { key: 'result', type: 'string', size: 20, required: true },
        ]);

        const existingAgents = await databases.listDocuments(dbId, 'agents', [Query.limit(100)]);
        const existingNames = new Set(existingAgents.documents.map((agent: any) => agent.name));

        for (const agent of seededAgents) {
          if (existingNames.has(agent.name)) continue;
          await databases.createDocument(dbId, 'agents', ID.unique(), {
            ...agent,
            won: 0,
            loss: 0,
            winRate: 0,
            promoted: false,
            isActive: true,
          });
        }

        console.log('Schema ready and Simpsons agents seeded.');
    } catch (error) {
        console.error('Setup failed:', error);
    }
}

setup();
