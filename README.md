# Pokémon Battle Arena - Online

A real-time, multiplayer Pokémon battle simulator where players can challenge each other to Pokémon battles.

## Features

- **Real-Time Multiplayer:** Challenge other players to a Pokémon battle in real-time.
- **Team Selection:** Choose a team of three Pokémon to battle with.
- **Turn-Based Combat:** Engage in turn-based combat with your opponent.
- **Leaderboard:** Track your wins and climb the leaderboard.

## Technologies

- **Node.js:** A JavaScript runtime environment that executes JavaScript code outside a web browser.
- **Express:** A minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications.
- **Socket.IO:** A library that enables real-time, bidirectional and event-based communication between the browser and the server.
- **PokéAPI:** A RESTful API that provides Pokémon data.

## Game Logic

The game logic is handled by the server and is divided into the following stages:

1. **Matchmaking:** Players are matched with each other in a lobby.
2. **Team Selection:** Players select a team of three Pokémon to battle with.
3. **Turn-Based Combat:** Players take turns to attack each other's Pokémon. The first player to defeat all of their opponent's Pokémon wins the battle.
4. **Damage Calculation:** The damage dealt by an attack is calculated based on the attacker's attack and the defender's defense.
5. **Winning/Losing Conditions:** A player wins the battle if they defeat all of their opponent's Pokémon. A player loses the battle if all of their Pokémon are defeated.

## Installation

To run the project locally, follow these steps:

1. Clone the repository.
2. Run `npm install` to install the dependencies.
3. Run `npm start` to start the server.
4. Open your browser and navigate to `http://localhost:3001`.

## Contributing

Contributions are welcome! If you would like to contribute to the project, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push your changes to your fork.
5. Open a pull request.

**Note:** If you make any changes to the project, please update the `README.md` file accordingly.

## License

This project is licensed under the ISC License. See the `LICENSE` file for more details.
