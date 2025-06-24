const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iuxl4dg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");

    app.get('/parcels', async (req, res) => {
        const parcels = parcelCollection.find().toArray();
        res.send(parcels);
    });

    // Assuming you have already connected MongoDB and have `parcelCollection`

app.post("/parcels", async (req, res) => {
  try {
    const newParcel = req.body;

    // Add timestamp if not already added
    //parcel.creation_date = parcel.creation_date || new Date().toISOString();

    const result = await parcelCollection.insertOne(newParcel);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error inserting parcel:", error);
    res.status(500).send({message: "Failed to create parcel" });
  }
});


    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Welcome to the API');
});
 app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
 });