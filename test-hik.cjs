fetch('http://localhost:3000/api/syscom/search?q=DS-2FA1205-C8/K')
  .then(res => res.json())
  .then(data => {
      if(data.productos && data.productos.length > 0) {
          console.log("PRODUCTO: ", JSON.stringify(data.productos[0], null, 2));
      } else {
          console.log("No products found");
      }
  })
  .catch(err => console.error(err));
