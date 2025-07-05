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

// varify admin role
  const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  if (!email) return res.status(401).send({ message: "Unauthorized" });

  try {
    const user = await usersCollection.findOne({ email });
    if(!user || user.role !== 'admin'){
      return res.status(403).send({message: "Forbidden accesss"})
    }
    next();
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).send({ message: "Failed to fetch user role" });
  }
};

// varify rider role
  const verifyRider = async (req, res, next) => {
  const email = req.decoded.email;
  if (!email) return res.status(401).send({ message: "Unauthorized" });

  try {
    const user = await usersCollection.findOne({ email });
    if(!user || user.role !== 'rider'){
      return res.status(403).send({message: "Forbidden accesss"})
    }
    next();
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).send({ message: "Failed to fetch user role" });
  }
};


  // search users
  app.get('/users/search', varifyFbToken, verifyAdmin, async (req, res) => {
   const email = req.query.email;
  if (!email) {
    return res.status(400).send({ message: "Email query parameter is required" });
  }
  try {
    const user = await usersCollection
    .find({ email: { $regex: email, $options: "i" } })
    .project({ displayName: 1, email: 1, role: 1 }) 
    .toArray();
   
    res.send(user);
  } catch (error) {
    console.error("Error searching user:", error);
    res.status(500).send({ message: "Server error" });
  }
});


// GET user role by email 
app.get('/users/role/:email', async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).send({ message: "Email parameter is required" });
    }

    const user = await usersCollection.findOne(
      { email }
    );

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send({ role: user.role || "user" }); // default to 'user' if no role assigned
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).send({ message: "Failed to get user role" });
  }
});


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

// make admin
app.patch('/users/admin/:id', varifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: 'admin' } }
    );
    res.send(result);
  } catch (error) {
    console.error('Error making admin:', error);
    res.status(500).send({ message: 'Failed to make admin' });
  }
});

// remove admin
app.patch('/users/remove-admin/:id', varifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: 'user' } }
    );
    res.send(result);
  } catch (error) {
    console.error('Error removing admin:', error);
    res.status(500).send({ message: 'Failed to remove admin' });
  }
});


// get parcels
app.get('/parcels', varifyFbToken, async (req, res) => {
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


// GET parcels with payment_status "paid" and delivery_status "pending"
app.get('/parcels/assignable', varifyFbToken, verifyAdmin, async (req, res) => {
  try {
    const parcels = await parcelCollection.find({
      payment_status: "paid",
      delivery_status: "pending"
    }).toArray();

    res.send(parcels);
  } catch (error) {
    console.error("Error fetching assignable parcels:", error);
    res.status(500).send({ message: "Failed to fetch parcels" });
  }
});


// GET a single parcel by ID
app.get("/parcels/:id", varifyFbToken, async (req, res) => {
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


// Update parcel delivery status with times
app.patch('/parcels/:id/update-status', varifyFbToken, verifyRider, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const updateData = { delivery_status: status };

    if (status === 'in_transit') {
      updateData.picked_time = new Date().toISOString();
    }

    if (status === 'delivered') {
      updateData.delivered_time = new Date().toISOString();
    }
console.log("Updating parcel", id, "with", updateData, );
    const result = await parcelCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.send(result);
  } catch (error) {
    console.error("Error updating parcel status:", error);
    res.status(500).send({ message: "Failed to update status" });
  }
});



// Cash out a single parcel
app.patch('/parcels/:id/cashout', varifyFbToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await parcelCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { cashout_status: "cashed_out" } }
    );

    res.send({ success: true, result });
  } catch (error) {
    console.log("Cashout error:", error);
    res.status(500).send({ message: "Cashout failed" });
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

// Get pending delivery parcels for a rider
app.get('/riders/:email/pending-tasks', varifyFbToken, verifyRider, async (req, res) => {
  const { email } = req.params;

  try {
    const parcels = await parcelCollection.find({
      assigned_rider_email: email,
      delivery_status: { $in: ["assigned", "in_transit"] }
    }).toArray();

    res.send(parcels);
  } catch (error) {
    console.error("Error fetching rider pending tasks:", error);
    res.status(500).send({ message: "Failed to fetch rider pending tasks" });
  }
});

// Get completed deliveries for a rider
app.get('/riders/:email/completed-tasks', varifyFbToken, verifyRider, async (req, res) => {
  const { email } = req.params;

  const options = {
    sort: { creation_date: -1 }
  }

  try {
    const completedParcels = await parcelCollection.find({
      assigned_rider_email: email,
      delivery_status: { $in: ["delivered", "service_center_delivered"] }
    }, options).toArray();

    res.send(completedParcels);
  } catch (error) {
    console.error("Error fetching rider completed deliveries:", error);
    res.status(500).send({ message: "Failed to fetch rider completed deliveries" });
  }
});


// GET all riders with pending status
app.get('/riders/pending', varifyFbToken, verifyAdmin, async (req, res) => {
  try {
    const pendingRiders = await ridersCollection.find({ status: 'pending' }).toArray();
    res.send(pendingRiders);
  } catch (error) {
    console.error("Error fetching pending riders:", error);
    res.status(500).send({ message: "Failed to load pending riders" });
  }
});

// Get active riders by district
app.get('/riders/by-district/:district', varifyFbToken, verifyAdmin, async (req, res) => {
  const { district } = req.params;

  try {
    const riders = await ridersCollection.find({
      status: 'active',
      district: district
    }).toArray();

    res.send(riders);
  } catch (error) {
    console.error("Error fetching riders by district:", error);
    res.status(500).send({ message: "Failed to fetch riders" });
  }
});


// Approve rider
app.patch('/riders/:id/approve', varifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });
    const riderResult = await ridersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'active' } }
    );

    // update user role
     const userResult = await usersCollection.updateOne(
      { email: rider.email },
      { $set: { role: 'rider' } }
    );
    res.send(riderResult);
  } catch (error) {
    console.error("Error approving rider:", error);
    res.status(500).send({ message: "Failed to approve rider" });
  }
});


// Assign rider to parcel and update rider's work_status
app.patch('/parcels/:id/assign-rider', varifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { riderId, riderName, riderEmail } = req.body;

  try {
    // Update parcel with assigned rider info
    const parcelResult = await parcelCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          assigned_rider_id: riderId,
          assigned_rider_name: riderName,
          assigned_rider_email: riderEmail,
          delivery_status: 'assigned'
        }
      }
    );

    // Update rider work_status to in_delivery
    const riderResult = await ridersCollection.updateOne(
      { _id: new ObjectId(riderId) },
      { $set: { work_status: "in_delivery" } }
    );

    res.send({ parcelResult, riderResult });
  } catch (error) {
    console.error("Error assigning rider:", error);
    res.status(500).send({ message: "Failed to assign rider" });
  }
});



// Delete (reject) rider
app.delete('/riders/:id', varifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await ridersCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    console.error("Error deleting rider:", error);
    res.status(500).send({ message: "Failed to delete rider" });
  }
});

// Get active riders with optional search by name
app.get('/riders/active', varifyFbToken, verifyAdmin,  async (req, res) => {
  const { name } = req.query;
  const filter = { status: 'active' };
  if (name) {
    filter.name = { $regex: name, $options: 'i' };
  }

  try {
    const riders = await ridersCollection.find(filter).toArray();
    res.send(riders);
  } catch (error) {
    console.error("Error fetching active riders:", error);
    res.status(500).send({ message: "Failed to fetch riders" });
  }
});

// Deactivate rider
app.patch('/riders/:id/deactivate',varifyFbToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });
    const result = await ridersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'inactive' } }
    );

     // update user role
     const userResult = await usersCollection.updateOne(
      { email: rider.email },
      { $set: { role: 'user' } }
    );
    res.send(result);
  } catch (error) {
    console.error("Error deactivating rider:", error);
    res.status(500).send({ message: "Failed to deactivate rider" });
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