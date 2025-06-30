const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);



const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// firebase admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


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
    const usersCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

// custom middleware
  const varifyFbToken = async(req,res,next)=>{
    const authHeaders = req.headers.authorization;
    if(!authHeaders){
      return res.status(401).send({message: "unauthorized access"})
    }

    const token = authHeaders.split(' ')[1];
    if(!token){
      return res.status(401).send({message: "unauthorized access"})
    }
      try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.decoded = decodedToken;
    next();
  } catch (error) {
    res.status(403).send({ message: "Forbidden access" });
  }
  }

// Save new user to DB if not exists
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    const existingUser = await usersCollection.findOne({ email: user.email });

    if (existingUser) {
      return res.send({ message: "User already exists", inserted: false });
    }

    const result = await usersCollection.insertOne(user);
    res.status(201).send({ message: "User created", inserted: true, result });
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).send({ message: "Failed to save user" });
  }
});

// get parcels
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
app.get("/payments",varifyFbToken , async (req, res) => {
 
  try {
    const { email } = req.query;
    if(req.decoded.email !== email){
      return res.status(403).send({ message: "Forbidden access"})
    }
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

//create riders
app.post("/riders", async (req, res) => {
  try {
    const rider = req.body;
    const result = await ridersCollection.insertOne(rider);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error creating rider application:", error);
    res.status(500).send({ message: "Failed to create rider application" });
  }
});

// GET all riders with pending status
app.get('/riders/pending', async (req, res) => {
  try {
    const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
    res.send(pendingRiders);
  } catch (error) {
    console.error("Error fetching pending riders:", error);
    res.status(500).send({ message: "Failed to load pending riders" });
  }
});

// Approve rider
app.patch('/riders/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await ridersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'active' } }
    );
    res.send(result);
  } catch (error) {
    console.error("Error approving rider:", error);
    res.status(500).send({ message: "Failed to approve rider" });
  }
});

// Delete (reject) rider
app.delete('/riders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await ridersCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    console.error("Error deleting rider:", error);
    res.status(500).send({ message: "Failed to delete rider" });
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