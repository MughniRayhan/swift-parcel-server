const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

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
    const paymentCollection = db.collection("payments")
  

    // Assuming you have already connected MongoDB and have `parcelCollection`

// get api
app.get('/parcels', async (req, res) => {
  try {
    const { email } = req.query;

    const query = email ? { created_by: email } : {};
    const options = {
      sort: { creation_date: -1 }, 
    };

    const parcels = await parcelCollection.find(query, options).toArray();
    res.send(parcels);
  } catch (error) {
    console.error("Error fetching parcels:", error);
    res.status(500).send({ message: "Failed to get parcels" });
  }
});

// GET a single parcel by ID
app.get("/parcels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
    if (!parcel) {
      return res.status(404).send({ message: "Parcel not found" });
    }
    res.send(parcel);
  } catch (error) {
    console.error("Error fetching parcel:", error);
    res.status(500).send({ message: "Failed to get parcel" });
  }
});


// DELETE a parcel by ID
app.delete("/parcels/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await parcelCollection.deleteOne(query);
   res.send(result);
  } catch (error) {
    console.error("Error deleting parcel:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});


// create parcels
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

//get payments
app.get("/payments", async (req, res) => {
  try {
    const { email } = req.query;
    const query = email ? { email } : {};
    const payments = await paymentCollection
      .find(query)
      .sort({ date: -1 }) 
      .toArray();

    res.send(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).send({ message: "Failed to load payments" });
  }
});


app.post("/payments", async (req, res) => {
  try {
    const payment = req.body;
    const { parcelId, email, amount, method, transactionId } = payment;

    // Insert payment into `payments` collection
    const paymentResult = await paymentCollection.insertOne({
      parcelId: new ObjectId(parcelId),
      email,
      amount,
      transactionId,
      method: method || "Stripe",
      date: new Date().toISOString(),
    });

 

    // Update parcel's payment_status to "paid"
    const parcelUpdateResult = await parcelCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { payment_status: "paid" } }
    );

    res.status(201).send({
      success: true,
      paymentResult,
      insertedId: paymentResult.insertedId,
      parcelUpdateResult,
      message: "Payment recorded and parcel marked as paid.",
    });
  } catch (error) {
    console.error("Error handling payment:", error);
    res.status(500).send({ message: "Payment processing failed" });
  }
});


// Stripe payment intent creation
app.post("/create-payment-intent", async (req, res) => {
  const { amount } = req.body; 
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, 
      currency: "usd",
      payment_method_types: ["card"],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error("Error creating payment intent:", err);
    res.status(500).send({ error: "Payment intent failed" });
  }
});


  } finally {
    
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Welcome to the API');
});
 app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
 });