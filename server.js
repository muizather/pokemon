// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

// --- Configuration ---
const AVAILABLE_POKEMON_IDS = [1, 4, 7, 25, 39, 74]; // Bulbasaur, Charmander, Squirtle, Pikachu, Jigglypuff, Geodude
const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2';
const MAX_MOVES_PER_POKEMON = 4;
const TARGET_GAME_VERSION_GROUP = 'scarlet-violet'; // Or 'sword-shield', 'ultra-sun-ultra-moon' etc. as fallback

// --- Server State ---
let waitingPlayer = null;
let activeGames = {};
let leaderboard = {};
let pokemonDataCache = {}; // Cache for fetched Pokémon details (including moves/ability)
let pokemonFetchPromises = {}; // Promise cache for deduplicating Pokémon requests
let moveDataCache = {}; // Cache for fetched move details (power)
let moveFetchPromises = {}; // Promise cache for deduplicating move requests
let availablePokemonDetails = []; // Basic info for selection screen

// --- PokéAPI Fetching Logic ---

/**
 * Fetches move details (specifically power) from PokéAPI.
 * Caches results. Returns { name: string, power: number }
 */
async function getMoveDetails(moveInfo) {
    const moveName = moveInfo.move.name;
    const moveUrl = moveInfo.move.url;

    if (moveDataCache[moveName]) {
        // Return clone from cache
        return structuredClone(moveDataCache[moveName]);
    }

    // Check if fetch is already in progress
    if (!moveFetchPromises[moveName]) {
        moveFetchPromises[moveName] = (async () => {
            // console.log(`Cache miss for move ${moveName}, fetching details...`);
            try {
                const response = await axios.get(moveUrl);
                const power = response.data.power;

                const moveData = {
                    name: moveName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '), // Format name
                    power: power === null ? 0 : power // Assign 0 power to status moves
                };

                moveDataCache[moveName] = moveData; // Store source of truth
                return moveData;
            } catch (error) {
                console.error(`Error fetching details for move "${moveName}":`, error.message);
                // Return a default representation if fetch fails
                return { name: moveName, power: 0 }; // Assign 0 power on error
            } finally {
                delete moveFetchPromises[moveName]; // Clean up promise
            }
        })();
    }

    try {
        const moveData = await moveFetchPromises[moveName];
        return structuredClone(moveData);
    } catch (error) {
        return { name: moveName, power: 0 };
    }
}


/**
 * Fetches and formats Pokémon data from PokéAPI, including selected moves and ability.
 * Caches results.
 */
async function getPokemonDetails(idOrName) {
    const identifier = String(idOrName).toLowerCase();

    // 1. Check Cache
    if (pokemonDataCache[identifier]) {
        // console.log(`Cache hit for ${identifier}`);
        return structuredClone(pokemonDataCache[identifier]);
    }

    // 2. Check Pending Requests (Thundering Herd Fix)
    if (!pokemonFetchPromises[identifier]) {
        pokemonFetchPromises[identifier] = (async () => {
            console.log(`Cache miss for ${identifier}, fetching Pokémon from PokéAPI...`);
            try {
                const response = await axios.get(`${POKEAPI_BASE_URL}/pokemon/${identifier}`);
                const data = response.data;

                const getStat = (statName) => data.stats.find(s => s.stat.name === statName)?.base_stat || 0;

                // --- Move Selection ---
                let selectedMoveInfos = [];
                // Find moves learned by leveling up in the target version group
                for (const moveInfo of data.moves) {
                     const learnMethod = moveInfo.version_group_details.find(vgd =>
                         vgd.version_group.name === TARGET_GAME_VERSION_GROUP && vgd.move_learn_method.name === 'level-up'
                     );
                     if (learnMethod) {
                         selectedMoveInfos.push(moveInfo); // Store the whole moveInfo temporarily
                     }
                     if (selectedMoveInfos.length >= MAX_MOVES_PER_POKEMON) break; // Stop once we have enough
                }
                // If not enough found in target version, take first few overall (less ideal)
                if (selectedMoveInfos.length < MAX_MOVES_PER_POKEMON) {
                    const needed = MAX_MOVES_PER_POKEMON - selectedMoveInfos.length;
                    const existingNames = selectedMoveInfos.map(m => m.move.name);
                    for (const moveInfo of data.moves) {
                         if (selectedMoveInfos.length >= MAX_MOVES_PER_POKEMON) break;
                         if (!existingNames.includes(moveInfo.move.name)) { // Avoid duplicates
                            selectedMoveInfos.push(moveInfo);
                         }
                    }
                }

                // Fetch details (power) for the selected moves concurrently
                const moveDetailPromises = selectedMoveInfos.map(moveInfo => getMoveDetails(moveInfo));
                const formattedMoves = await Promise.all(moveDetailPromises);

                // --- Ability Selection ---
                const firstAbilityInfo = data.abilities?.find(a => !a.is_hidden); // Find first non-hidden ability
                const abilityName = firstAbilityInfo ? firstAbilityInfo.ability.name.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ') : 'Unknown'; // Format name

                const formattedData = {
                    id: data.id,
                    apiId: identifier,
                    name: data.name.charAt(0).toUpperCase() + data.name.slice(1),
                    hp: getStat('hp'),
                    attack: getStat('attack'),
                    defense: getStat('defense'),
                    speed: getStat('speed'),
                    spriteUrl: data.sprites?.front_default || null,
                    moves: formattedMoves.filter(m => m !== null), // Ensure only successful fetches are included
                    abilityName: abilityName, // Add ability name
                };

                pokemonDataCache[identifier] = formattedData; // Store Source
                console.log(`Fetched and formatted ${formattedData.name} (ID: ${formattedData.id}) with ${formattedData.moves.length} moves and ability ${formattedData.abilityName}.`);
                return formattedData;

            } catch (error) {
                console.error(`Error fetching Pokémon data for "${identifier}":`, error.message);
                if (error.response && error.response.status === 404) console.error(`Pokemon "${identifier}" not found.`);
                else console.error(`Network/other error fetching ${identifier}.`);
                throw error; // Propagate error to remove from promise map
            } finally {
                delete pokemonFetchPromises[identifier];
            }
        })();
    }

    try {
        const data = await pokemonFetchPromises[identifier];
        return structuredClone(data);
    } catch (error) {
        return null;
    }
}

/**
 * Creates a game instance of a Pokémon from fetched data.
 */
function createPokemonInstance(baseData) {
    if (!baseData) return null;
    return {
        ...baseData, // Includes id, name, stats, spriteUrl, moves, abilityName
        maxHp: baseData.hp,
        currentHp: baseData.hp,
        fainted: false,
    };
}

// --- Pre-fetch available Pokémon details on server start ---
async function initializeAvailablePokemon() {
    console.log("Initializing available Pokémon details (basic)...");
    const promises = AVAILABLE_POKEMON_IDS.map(id => getPokemonDetails(id)); // Fetch full details to cache them
    const results = await Promise.all(promises);
    // Create the list for the selection screen (only basic info needed)
    availablePokemonDetails = results.filter(details => details !== null).map(d => ({
        id: d.id,
        name: d.name,
        spriteUrl: d.spriteUrl
        // No need to send moves/ability/stats for selection screen list
    }));
    if (availablePokemonDetails.length > 0) {
        console.log(`Successfully initialized ${availablePokemonDetails.length} available Pokémon basics.`);
    } else {
        console.error("Failed to initialize any available Pokémon!");
    }
}

// Initialize on server start
initializeAvailablePokemon();


// --- Serve static files and HTML ---
app.get('/', (req, res) => { /* Keep as is */
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.username = `Anon_${socket.id.substring(0, 4)}`;

    // Send the list of available Pokémon for selection
    socket.emit('availablePokemon', availablePokemonDetails);

    // ADDED: Handle client request for available pokemon (e.g., after reset)
    socket.on('requestAvailablePokemon', () => {
        socket.emit('availablePokemon', availablePokemonDetails);
    });

    // setUsername, findMatch logic remains the same
    socket.on('setUsername', (username) => { /* Keep as is */
        const cleanUsername = username.trim().slice(0, 16) || `Anon_${socket.id.substring(0, 4)}`;
        socket.username = cleanUsername;
        console.log(`Socket ${socket.id} set username to: ${socket.username}`);
        socket.emit('usernameSet', socket.username);
    });

    socket.on('findMatch', () => { /* Keep as is */
        if (!socket.username) { socket.emit('gameError', { message: 'Please set a username first.' }); return; }
        console.log(`Player ${socket.username} (${socket.id}) looking for match`);
        socket.join('lobby');
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            const player1 = waitingPlayer; const player2 = socket; const gameId = uuidv4();
            if (!player1.username || !player2.username) { /* ... error handling ... */ return; }
            console.log(`Match found! Game ID: ${gameId}, P1: ${player1.username}, P2: ${player2.username}`);
            waitingPlayer = null; player1.leave('lobby'); player2.leave('lobby'); player1.join(gameId); player2.join(gameId);
            activeGames[gameId] = { id: gameId, players: { [player1.id]: { id: player1.id, username: player1.username, team: null, activePokemonIndex: 0, hasSelected: false, isPlayer1: true }, [player2.id]: { id: player2.id, username: player2.username, team: null, activePokemonIndex: 0, hasSelected: false, isPlayer1: false } }, playerOrder: [player1.id, player2.id], battleState: null, turn: null, log: ["Match found! Select your teams."] };
            player1.emit('matchFound', { gameId, opponentUsername: player2.username }); player2.emit('matchFound', { gameId, opponentUsername: player1.username });
        } else if (!waitingPlayer || waitingPlayer.id === socket.id) { waitingPlayer = socket; socket.emit('waitingForOpponent'); console.log(`Player ${socket.username} waiting.`);
        } else { console.warn("Unexpected state in findMatch"); waitingPlayer = socket; socket.emit('waitingForOpponent'); }
    });

    // selectTeam uses the fetched details (including moves) now
    socket.on('selectTeam', async ({ gameId, teamIds }) => { // async remains
        const game = activeGames[gameId];
         // Basic validation remains
        if (!game || !game.players[socket.id] || game.players[socket.id].hasSelected) { /* ... error ... */ return; }
        if (!Array.isArray(teamIds) || teamIds.length !== 3 || !teamIds.every(id => typeof id === 'number')) { /* ... error ... */ return; }

        console.log(`Player ${socket.username} selected team IDs for game ${gameId}:`, teamIds);
        try {
            // Fetch full details (which includes moves/ability) concurrently
            const fetchPromises = teamIds.map(id => getPokemonDetails(id));
            const pokemonBaseDataArray = await Promise.all(fetchPromises);

            if (pokemonBaseDataArray.some(data => data === null)) { /* ... error handling ... */ return; }

            // Create instances - moves/ability are now part of baseData
            game.players[socket.id].team = pokemonBaseDataArray.map(baseData => createPokemonInstance(baseData));
            game.players[socket.id].hasSelected = true;
            console.log(`Team instantiated for ${socket.username}:`, game.players[socket.id].team.map(p => `${p.name} (${p.moves.length} moves)`));

            // Battle start logic remains the same
            const player1Data = game.players[game.playerOrder[0]]; const player2Data = game.players[game.playerOrder[1]];
            if (player1Data.hasSelected && player2Data.hasSelected) {
                console.log(`Both players selected teams for game ${gameId}. Starting battle.`);
                 if(!player1Data.team || !player2Data.team || player1Data.team.length !== 3 || player2Data.team.length !== 3) { /* ... error handling ... */ return; }
                 game.battleState = { player1: { ...player1Data, activePokemon: player1Data.team[0] }, player2: { ...player2Data, activePokemon: player2Data.team[0] } };
                const p1Speed = game.battleState.player1.activePokemon.speed; const p2Speed = game.battleState.player2.activePokemon.speed;
                game.turn = (p1Speed >= p2Speed) ? player1Data.id : player2Data.id;
                game.log = [ `Battle Start!`, `${game.battleState.player1.username}'s ${game.battleState.player1.activePokemon.name} vs ${game.battleState.player2.username}'s ${game.battleState.player2.activePokemon.name}!`, `It's ${game.players[game.turn].username}'s turn!` ];
                io.to(gameId).emit('battleStart', getSanitizedGameState(gameId));
            } else { const opponentId = game.playerOrder.find(id => id !== socket.id); io.to(opponentId).emit('opponentReady'); socket.emit('waitingForOpponentSelection'); }
        } catch (error) { console.error(`Error during team selection/fetch for game ${gameId}, player ${socket.id}:`, error); socket.emit('gameError', { message: "An internal error occurred during team selection." }); }
    });

    // performAction - damage calculation relies on move.power from fetched data
    socket.on('performAction', ({ gameId, action }) => { /* Logic mostly the same */
        const game = activeGames[gameId];
        // Basic checks remain
        if (!game || !game.battleState || socket.id !== game.turn) { /* ... error ... */ return; }
        const currentPlayerId = socket.id; const opponentId = game.playerOrder.find(id => id !== currentPlayerId);
        let playerState, opponentState; // Identify player/opponent states
        if (game.battleState.player1.id === currentPlayerId) { playerState = game.battleState.player1; opponentState = game.battleState.player2; }
        else { playerState = game.battleState.player2; opponentState = game.battleState.player1; }
        if (!playerState || !opponentState || !playerState.activePokemon || !opponentState.activePokemon) { /* ... error ... */ return; }
        let playerPokemon = playerState.activePokemon; let opponentPokemon = opponentState.activePokemon;
        // Forced switch check remains
        if (playerState.mustSwitch && action.type !== 'switch') { /* ... error ... */ return; }
        game.log = []; let turnEnded = false; let gameOver = false; let winnerId = null;

        try {
            if (action.type === 'attack') {
                // Find move from the fetched moves array
                const move = playerPokemon.moves?.find(m => m.name === action.moveName);
                if (!move || !playerPokemon.moves || playerPokemon.fainted) { /* ... error ... */ return; }
                game.log.push(`${playerState.username}'s ${playerPokemon.name} used ${move.name}!`);
                // Calculate damage using fetched power (0 for status moves)
                const damage = calculateDamage(playerPokemon, opponentPokemon, move);
                if (move.power > 0) { // Only log damage if power > 0
                    game.log.push(`${opponentState.username}'s ${opponentPokemon.name} took ${damage} damage.`);
                } else {
                     game.log.push(`It had no effect...`); // Or some other message for status moves
                }
                opponentPokemon.currentHp -= damage;
                if (opponentPokemon.currentHp <= 0) { // Faint logic remains same
                     opponentPokemon.currentHp = 0; opponentPokemon.fainted = true; game.log.push(`${opponentState.username}'s ${opponentPokemon.name} fainted!`);
                     const availableOpponentPokemon = opponentState.team.filter(p => !p.fainted);
                     if (availableOpponentPokemon.length === 0) { gameOver = true; winnerId = currentPlayerId; }
                     else { game.turn = opponentId; opponentState.mustSwitch = true; turnEnded = true; }
                } else { turnEnded = true; }
            } else if (action.type === 'switch') { // Switch logic remains same
                 const team = playerState.team; const targetIndex = action.pokemonIndex;
                 if (targetIndex < 0 || targetIndex >= team.length || !team[targetIndex] || team[targetIndex].fainted || team[targetIndex].id === playerPokemon.id) { /* ... error ... */ return; }
                 const oldPokemonName = playerPokemon.name;
                 playerState.activePokemon = team[targetIndex]; playerState.activePokemonIndex = targetIndex;
                 playerPokemon = playerState.activePokemon; // Update local ref is optional now
                 game.log.push(`${playerState.username} switched from ${oldPokemonName} to ${playerPokemon.name}!`);
                 if (playerState.mustSwitch) playerState.mustSwitch = false;
                 turnEnded = true;
            } else { socket.emit('gameError', { message: "Unknown action type." }); return; }

            // Post-action processing remains same
            if (gameOver) { /* ... game over logic ... */
                const winnerUsername = game.players[winnerId].username; const loserUsername = game.players[opponentId].username;
                game.log.push(`Game Over! ${winnerUsername} defeated ${loserUsername}!`);
                leaderboard[winnerUsername] = (leaderboard[winnerUsername] || 0) + 1; console.log("Leaderboard updated:", leaderboard);
                io.to(gameId).emit('gameStateUpdate', getSanitizedGameState(gameId)); // Send final state first
                io.to(gameId).emit('gameOver', { winnerId: winnerId, finalState: getSanitizedGameState(gameId) });
                delete activeGames[gameId];
                const p1Socket = io.sockets.sockets.get(game.playerOrder[0]); const p2Socket = io.sockets.sockets.get(game.playerOrder[1]);
                if (p1Socket) p1Socket.leave(gameId); if (p2Socket) p2Socket.leave(gameId); console.log(`Game ${gameId} ended. Sockets removed.`);
            } else if (turnEnded) { /* ... turn end logic ... */
                if (!opponentState.mustSwitch) {
                     game.turn = opponentId; game.log.push(`It's ${opponentState.username}'s turn!`);
                     io.to(gameId).emit('gameStateUpdate', getSanitizedGameState(gameId));
                } else {
                     game.log.push(`${opponentState.username} must switch Pokémon!`);
                     io.to(gameId).emit('gameStateUpdate', getSanitizedGameState(gameId));
                     io.to(opponentId).emit('forceSwitch', { reason: `${opponentPokemon.name} fainted!` });
                }
            }
        } catch (error) { /* ... error handling ... */
            console.error(`Error processing action game ${gameId}:`, error);
            socket.emit('gameError', { message: "Internal server error processing action." });
            try { io.to(gameId).emit('gameStateUpdate', getSanitizedGameState(gameId)); } catch (stateError) { console.error("Failed to send state after error:", stateError); }
        }
    });

    // getLeaderboard, disconnect logic remains the same
    socket.on('getLeaderboard', () => { /* Keep as is */
        const sortedLeaderboard = Object.entries(leaderboard).sort(([, winsA], [, winsB]) => winsB - winsA).slice(0, 10);
        const leaderboardData = sortedLeaderboard.map(([username, wins], index) => ({ rank: index + 1, username: username, wins: wins }));
        socket.emit('leaderboardData', leaderboardData);
    });
    socket.on('disconnect', (reason) => { /* Keep as is */
        console.log(`User ${socket.username} (${socket.id}) disconnected: ${reason}`);
        if (waitingPlayer && waitingPlayer.id === socket.id) { waitingPlayer = null; console.log('Waiting player disconnected.'); }
        const gameId = Object.keys(activeGames).find(id => activeGames[id]?.players[socket.id]);
        if (gameId) {
             const game = activeGames[gameId]; const disconnectedUsername = game.players[socket.id]?.username || 'Player'; console.log(`${disconnectedUsername} disconnected from game ${gameId}`); const opponentId = game.playerOrder?.find(id => id !== socket.id);
             delete activeGames[gameId]; console.log(`Game ${gameId} deleted due to disconnect.`);
             if (opponentId && io.sockets.sockets.get(opponentId)) {
                 const opponentSocket = io.sockets.sockets.get(opponentId); const opponentUsername = game.players[opponentId]?.username || 'Opponent';
                 if (game.battleState) { leaderboard[opponentUsername] = (leaderboard[opponentUsername] || 0) + 1; console.log(`Awarded win to ${opponentUsername}. LB:`, leaderboard); }
                 opponentSocket.emit('opponentDisconnected', { message: `${disconnectedUsername} disconnected. ${game.battleState ? 'You win!' : 'Match cancelled.'}` });
                 opponentSocket.leave(gameId); console.log(`Notified ${opponentUsername} and removed from room ${gameId}.`);
             } else if (opponentId) { console.log(`Opponent ${opponentId} not found/connected.`); const staleOpponentSocket = io.sockets.sockets.get(opponentId); if (staleOpponentSocket) staleOpponentSocket.leave(gameId); }
        }
    });
});

// --- Helper Functions ---
// calculateDamage uses move.power (0 for status moves)
// --- Helper Functions ---

// Corrected calculateDamage function
function calculateDamage(attacker, defender, move) {
    // Basic check for essential data
    if (!attacker || !defender || !move || !attacker.attack || !defender.defense || typeof move.power !== 'number' || defender.defense <= 0) {
        console.warn("Missing data for damage calc:", { atk: !!attacker, def: !!defender, move: !!move, pwr: move?.power });
        return 0; // Return 0 damage if data is bad or power is not a number
    }
    if (move.power === 0) return 0; // Explicitly return 0 for status moves

    // Simple damage formula
    const baseDamage = Math.floor(((attacker.attack / defender.defense) * move.power / 8) + 2); // Calculate baseDamage
    const randomFactor = (Math.random() * 0.15) + 0.85; // 85% to 100%

    // THE FIX IS HERE: Use baseDamage, not baseData
    const finalDamage = Math.max(1, Math.floor(baseDamage * randomFactor)); // Ensure at least 1 damage for damaging moves

    // console.log(`Damage Calc: ${attacker.name} (${attacker.attack}) vs ${defender.name} (${defender.defense}) with ${move.name} (${move.power}) -> ${finalDamage}`); // DEBUG
    return finalDamage;
}

// getSanitizedGameState function (keep as it was)
function getSanitizedGameState(gameId) {
    // ... (keep the existing sanitize function)
    const game = activeGames[gameId];
    if (!game) return null;

    const sanitizePlayer = (playerState) => {
        if (!playerState) return null;
        return {
            id: playerState.id,
            username: playerState.username,
            team: playerState.team?.map(p => ({
                id: p.id, name: p.name, currentHp: p.currentHp, maxHp: p.maxHp, fainted: p.fainted, spriteUrl: p.spriteUrl,
                abilityName: p.abilityName
            })) || [],
            activePokemon: playerState.activePokemon ? {
                id: playerState.activePokemon.id, name: playerState.activePokemon.name,
                currentHp: playerState.activePokemon.currentHp, maxHp: playerState.activePokemon.maxHp,
                fainted: playerState.activePokemon.fainted, spriteUrl: playerState.activePokemon.spriteUrl,
                moves: playerState.activePokemon.moves,
                abilityName: playerState.activePokemon.abilityName
            } : null,
            activePokemonIndex: playerState.activePokemonIndex,
            mustSwitch: playerState.mustSwitch || false,
        };
    };

    const stateToSend = {
        gameId: game.id,
        battleState: {
            player1: game.battleState ? sanitizePlayer(game.battleState.player1) : null,
            player2: game.battleState ? sanitizePlayer(game.battleState.player2) : null,
        },
        turn: game.turn,
        log: game.log || [],
    };
    return stateToSend;
}

// Start Server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});