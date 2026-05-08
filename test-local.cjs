fetch('http://localhost:3000/api/syscom/search?q=tecnopatch')
  .then(res => res.json())
  .then(data => {
      if(data.productos && data.productos.length > 0) {
          console.log("PRECIOS DEL PRODUCTO: ", JSON.stringify(data.productos[0].precios, null, 2));
      } else {
          console.log("No products found");
      }
  })
  .catch(err => console.error(err));
