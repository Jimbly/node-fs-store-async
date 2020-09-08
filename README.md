node-fs-store-async
===================

Data storage compatible, async, version of [node-fs-store](https://github.com/Jimbly/node-fs-store).

Use temporarily while migrating to a purely async API.

Example
```javascript
const { createFileStore } = require('fs-store-async');

createFileStore('example_data.json', function (err, my_store) {
  // Get a value, providing a default
  let number_of_runs = my_store.get('number_of_runs', 0);
  ++number_of_runs;
  // Store a value (will be written to disk asynchronously)
  my_store.set('number_of_runs', number_of_runs, () => console.log('async write finished'));
  console.log('This example has run ' + number_of_runs + ' time(s)');
});
```