-- More trivia questions for the phone game pool.
--
-- Editor-safe (paste into the Supabase SQL editor): ONE statement, choices built
-- with jsonb_build_array (no inline JSON string literals, which the editor
-- choked on for 0028), every row on a single line (no wrapped literals), and a
-- NOT EXISTS guard per prompt so re-running never inserts duplicates.

insert into trivia_questions (prompt, choices, correct_idx)
select v.prompt, v.choices, v.correct_idx
from (values
  ('What is the capital of Australia?', jsonb_build_array('Sydney','Melbourne','Canberra','Perth'), 2),
  ('How many sides does a hexagon have?', jsonb_build_array('Five','Six','Seven','Eight'), 1),
  ('What is the largest mammal in the world?', jsonb_build_array('African elephant','Blue whale','Giraffe','Hippopotamus'), 1),
  ('What is the chemical formula for water?', jsonb_build_array('CO2','H2O','O2','NaCl'), 1),
  ('How many players from one soccer team are on the field at kickoff?', jsonb_build_array('Nine','Ten','Eleven','Twelve'), 2),
  ('Which country gave the Statue of Liberty to the United States?', jsonb_build_array('France','United Kingdom','Spain','Italy'), 0),
  ('What is the hardest known natural material?', jsonb_build_array('Gold','Iron','Diamond','Quartz'), 2),
  ('How many colors are in a rainbow?', jsonb_build_array('Five','Six','Seven','Eight'), 2),
  ('Who painted the Mona Lisa?', jsonb_build_array('Vincent van Gogh','Pablo Picasso','Leonardo da Vinci','Michelangelo'), 2),
  ('What is the smallest prime number?', jsonb_build_array('Zero','One','Two','Three'), 2),
  ('Which planet is known as the Red Planet?', jsonb_build_array('Venus','Mars','Jupiter','Mercury'), 1),
  ('How many bones are in the adult human body?', jsonb_build_array('196','206','216','226'), 1),
  ('What is the capital of Japan?', jsonb_build_array('Seoul','Beijing','Tokyo','Bangkok'), 2),
  ('Which ocean lies between the Americas and Europe?', jsonb_build_array('Pacific','Atlantic','Indian','Arctic'), 1),
  ('How many legs does a spider have?', jsonb_build_array('Six','Eight','Ten','Twelve'), 1),
  ('What is the freezing point of water in Fahrenheit?', jsonb_build_array('0 degrees','32 degrees','100 degrees','212 degrees'), 1),
  ('Which US state is nicknamed the Sunshine State?', jsonb_build_array('Texas','California','Florida','Arizona'), 2),
  ('Who wrote the play Romeo and Juliet?', jsonb_build_array('Charles Dickens','William Shakespeare','Mark Twain','Jane Austen'), 1),
  ('What is the largest country in the world by area?', jsonb_build_array('China','United States','Canada','Russia'), 3),
  ('How many strings does a standard violin have?', jsonb_build_array('Three','Four','Five','Six'), 1),
  ('What is the currency of Japan?', jsonb_build_array('Yuan','Won','Yen','Baht'), 2),
  ('How many planets are in our solar system?', jsonb_build_array('Seven','Eight','Nine','Ten'), 1),
  ('What is the boiling point of water in Celsius?', jsonb_build_array('50 degrees','90 degrees','100 degrees','110 degrees'), 2),
  ('Which is the smallest planet in our solar system?', jsonb_build_array('Mercury','Mars','Earth','Venus'), 0),
  ('Which sport uses a shuttlecock?', jsonb_build_array('Tennis','Badminton','Squash','Cricket'), 1),
  ('How many days are in a leap year?', jsonb_build_array('364','365','366','367'), 2),
  ('What is the main ingredient in guacamole?', jsonb_build_array('Tomato','Avocado','Bell pepper','Onion'), 1),
  ('What color do you get by mixing blue and yellow?', jsonb_build_array('Green','Purple','Orange','Brown'), 0),
  ('How many cards are in a standard deck without jokers?', jsonb_build_array('48','50','52','54'), 2),
  ('Who was the first person to walk on the moon?', jsonb_build_array('Buzz Aldrin','Neil Armstrong','Yuri Gagarin','Michael Collins'), 1),
  ('What is the tallest mountain above sea level on Earth?', jsonb_build_array('K2','Mount Everest','Kilimanjaro','Denali'), 1),
  ('Which language has the most native speakers worldwide?', jsonb_build_array('English','Spanish','Mandarin Chinese','Hindi'), 2),
  ('What is the chemical symbol for oxygen?', jsonb_build_array('O','Ox','Og','Oy'), 0),
  ('What is the largest organ in the human body?', jsonb_build_array('Liver','Skin','Heart','Lungs'), 1),
  ('Which country is the natural home of the kangaroo?', jsonb_build_array('South Africa','Australia','Brazil','India'), 1),
  ('What is the capital of Canada?', jsonb_build_array('Toronto','Vancouver','Ottawa','Montreal'), 2),
  ('Which metal is liquid at room temperature?', jsonb_build_array('Iron','Mercury','Lead','Tin'), 1),
  ('Which planet is closest to the sun?', jsonb_build_array('Venus','Mercury','Earth','Mars'), 1),
  ('How many zeros are in one million?', jsonb_build_array('Five','Six','Seven','Eight'), 1),
  ('What is the national bird of the United States?', jsonb_build_array('Bald eagle','Wild turkey','Red hawk','Great owl'), 0),
  ('Which is the smallest ocean?', jsonb_build_array('Atlantic','Indian','Arctic','Pacific'), 2),
  ('What is the fastest land animal?', jsonb_build_array('Lion','Cheetah','Horse','Greyhound'), 1),
  ('How many teeth does a typical adult human have?', jsonb_build_array('28','30','32','34'), 2),
  ('What is frozen water called?', jsonb_build_array('Steam','Ice','Vapor','Dew'), 1),
  ('Which instrument has 88 keys?', jsonb_build_array('Guitar','Piano','Violin','Harp'), 1),
  ('Which vitamin does your body make from sunlight?', jsonb_build_array('Vitamin A','Vitamin C','Vitamin D','Vitamin K'), 2),
  ('In which sport would you perform a slam dunk?', jsonb_build_array('Soccer','Basketball','Tennis','Golf'), 1),
  ('What is the most common gas in our atmosphere?', jsonb_build_array('Oxygen','Nitrogen','Carbon dioxide','Argon'), 1),
  ('How many feet are in a yard?', jsonb_build_array('Two','Three','Four','Five'), 1),
  ('Which famous ship sank in 1912?', jsonb_build_array('Titanic','Lusitania','Mayflower','Endeavour'), 0),
  ('What is the capital of Italy?', jsonb_build_array('Venice','Milan','Rome','Naples'), 2),
  ('Which is the largest of the big cats?', jsonb_build_array('Leopard','Lion','Tiger','Jaguar'), 2),
  ('What does a thermometer measure?', jsonb_build_array('Weight','Temperature','Pressure','Speed'), 1),
  ('How many sides does a stop sign have?', jsonb_build_array('Six','Seven','Eight','Nine'), 2),
  ('What is the main language spoken in Brazil?', jsonb_build_array('Spanish','Portuguese','French','English'), 1),
  ('Which planet is famous for its rings?', jsonb_build_array('Mars','Saturn','Venus','Mercury'), 1),
  ('What is the largest US state by area?', jsonb_build_array('Texas','California','Alaska','Montana'), 2),
  ('How many seconds are in one minute?', jsonb_build_array('30','60','90','100'), 1),
  ('Which holiday falls on the 25th of December?', jsonb_build_array('Easter','Christmas','Halloween','New Year'), 1),
  ('What do you call a baby dog?', jsonb_build_array('Kitten','Puppy','Cub','Calf'), 1),
  ('Which country is home to the Great Pyramid of Giza?', jsonb_build_array('Greece','Egypt','Mexico','Peru'), 1),
  ('What color do you get by mixing red and white?', jsonb_build_array('Pink','Purple','Orange','Gray'), 0),
  ('How many continents begin with the letter A?', jsonb_build_array('Two','Three','Four','Five'), 2),
  ('Which gas do plants release during photosynthesis?', jsonb_build_array('Carbon dioxide','Oxygen','Nitrogen','Methane'), 1)
) as v(prompt, choices, correct_idx)
where not exists (
  select 1 from trivia_questions q where q.prompt = v.prompt
);
