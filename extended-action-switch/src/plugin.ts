import streamDeck from "@elgato/streamdeck";

import { ExtendedActionSwitch } from "./actions/extended-action-switch";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the extended action switch.
streamDeck.actions.registerAction(new ExtendedActionSwitch());

// Finally, connect to the Stream Deck.
streamDeck.connect();
