import express from "express";
import dotenv from "dotenv";
import axios from "axios";


dotenv.config();

const app = express();

app.use(express.json());

const ID = process.env.NODE_ID;
const PORT = process.env.PORT;

const lastSeen = new Map();
const TIMEOUT = 6000;
let leader = null;
const rank = { A: 1, B: 2, C: 3, D: 4 };
let electionInProgress = false;

const peers = {
  A: [
    { id: "B", url: "http://localhost:3002" },
    { id: "C", url: "http://localhost:3003" },
    { id: "D", url: "http://localhost:3004" },
  ],
  B: [
    { id: "A", url: "http://localhost:3001" },
    { id: "C", url: "http://localhost:3003" },
    { id: "D", url: "http://localhost:3004" },
  ],
  C: [
    { id: "A", url: "http://localhost:3001" },
    { id: "B", url: "http://localhost:3002" },
    { id: "D", url: "http://localhost:3004" },
  ],
  D: [
    { id: "A", url: "http://localhost:3001" },
    { id: "B", url: "http://localhost:3002" },
    { id: "C", url: "http://localhost:3003" },
  ],
};

if (!ID || !PORT || !peers[ID]) {
    throw new Error("NODE_ID or PORT not set");
}

for (const peer of peers[ID]) {
    lastSeen.set(peer.id, null);
}

app.get("/status", (req, res) => {
    return res.status(200).json({
        server: ID,
        peers: getStatuses()
    });
});

app.get("/alive", (req, res) => {
    res.json({ server: ID, alive: true})
});

app.post("/heartbeat", (req, res) => {
    const { ID: senderId, PORT: senderPort } = req.body;

    if (!lastSeen.has(senderId)) {
        return res.status(400).json({ message: "Unknown peer" });
    }

    lastSeen.set(senderId, Date.now());

    console.log(`Heartbeat request received from Server ${senderId} on Port ${senderPort}`);
    return res.status(200).json({ message: `Heartbeat request successfully received by Server ${ID} on Port ${PORT}` })

});

function getStatuses () {
    const statuses = {}

    for (const [peerId, time] of lastSeen) {
        if (time === null) {
            statuses[peerId] = "UNKNOWN";
        } else if (Date.now() - time > TIMEOUT) {
            statuses[peerId] = "FAILED";
        } else {
            statuses[peerId] = "HEALTHY";
        }
    }

    return statuses;
};

async function startElection () {
    if (electionInProgress) return;

    electionInProgress = true;

    try {
        
        const higherPeers = peers[ID].filter(peer => rank[peer.id] > rank[ID]);

        const results = await Promise.all(
            higherPeers.map(async (peer) => {
                try {
                    await axios.post(`${peer.url}/election`, {}, { timeout: 1500 });
                    return true;
                } catch {
                    return false;
                }
            })
        );

        const higherAlive = results.some(Boolean);

        if (!higherAlive) {
            leader = ID;
            console.log(`I am the leader: Server ${ID}`);

            await Promise.all(
                peers[ID].map(peer =>
                axios.post(
                    `${peer.url}/coordinator`,
                    { candidate: ID },
                    { timeout: 1500 }
                ).catch(() => {})
                )
            );
        }

    } finally {
        electionInProgress = false;
    }
};

app.get("/", (req, res) => {
    return res.status(200).json({
        id: ID,
        port: PORT,
        status: "OK"
    });
});

app.get("/leader", (req, res) => {
    return res.json({ server: ID, leader });
});

app.post("/election", (req, res) => {
    res.json({ accepted: true });

    setTimeout(() => { startElection() }, 0);
});

app.post("/coordinator", (req, res) => {

    const { candidate } = req.body;

    if (rank[candidate] && candidate !== ID) {
        leader = candidate;
        console.log(`New leader elected: Server ${leader}`);
    }

    res.json({ leader });

});

setInterval(async () => {
    for (const peer of peers[ID]) {
        try {
            const response = await axios.post(`${peer.url}/heartbeat`, { ID, PORT }, { timeout: 1000 });
            console.log(`Heartbeat request sent to ${peer.url} \n\n`)
            console.log(response.data);
        } catch (error) {
            console.error(`Could not reach ${peer.url} \n`);
            const time = lastSeen.get(peer.id);
            console.log(`Server ${peer.id}'s current status is ${time === null ? "UNKNOWN" : Date.now() - time > TIMEOUT ? "FAILED" : "HEALTHY"}`);
        }
    }
}, 2000); 

setInterval(() => {
    const statuses = getStatuses();

    const allKnown = Object.values(statuses).every(status => status !== "UNKNOWN");

    if (leader === null && allKnown) {
        startElection();
    } else if (leader && leader !== ID && statuses[leader] === "FAILED") {
        startElection();
    }
}, 3000);


setInterval(() => {
    for (const [peerID, time] of lastSeen) {
        if (time === null) {
            console.log(`Server ${peerID} has a status of UNKNOWN`)
        } else if (Date.now() - time > TIMEOUT) {
            console.log(`Server ${peerID} has FAILED`)
        } else {
            console.log(`Server ${peerID} is HEALTHY`)
        }
    }
}, 3000)

app.listen(PORT, () => {
    console.log(`Node ${ID} listening on port ${PORT}`);
})